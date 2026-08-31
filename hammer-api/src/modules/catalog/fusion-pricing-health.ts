import { Prisma, PrismaClient } from "@prisma/client";
import { getEffectiveProductPricingBatch, resolveCostChain } from "@/modules/catalog/effective-pricing";

/**
 * prompt-costos-precios-fusion.md §2.3 — verificación de salud de PRECIO Y
 * COSTO en fusiones. Deliberadamente en un archivo propio, separado de
 * stock-group-health.ts: ese archivo se llama dentro de transacciones
 * calientes (apertura de paquete, etc — inventory/service.ts) y nunca debe
 * ganar latencia extra. Este archivo hace más consultas (precio/costo de
 * cada miembro en cada sucursal) y solo lo llaman procesos que pueden
 * pagarlo: el script de auditoría (scripts/audit-pricing-coherence.ts) y el
 * detector de Brain (brain/detectors/pricing-detector.ts).
 */

type DbClient = PrismaClient | Prisma.TransactionClient;

/** 5% relativo — dos miembros cuyo costo/precio base implícito difiere más que esto están en conflicto real, no ruido de redondeo. */
export const FUSION_BASIS_CONFLICT_TOLERANCE = 0.05;
/** Margen sobre el 90% es un síntoma casi seguro de costo de relleno (el 97.14% del ejemplo de arena del doc), no de un producto genuinamente así de rentable. */
export const MARGIN_OUTLIER_HIGH_THRESHOLD = 0.9;
/** Costos que casi seguro son un valor de relleno tecleado ("algo hay que poner"), no un costo real. */
const PLACEHOLDER_COST_VALUES = [new Prisma.Decimal(0), new Prisma.Decimal(1)];
const PLACEHOLDER_EPSILON = new Prisma.Decimal("0.01");

export type FusionPricingIssueKind = "UNSELLABLE" | "COST_BASIS_CONFLICT" | "PRICE_BASIS_CONFLICT" | "PLACEHOLDER_COST" | "MARGIN_OUTLIER";

export type FusionPricingIssue = {
  branchId: string;
  /** productId único para conflictos de un solo producto; join de IDs para COST/PRICE_BASIS_CONFLICT (varios miembros implicados). */
  productId: string;
  kind: FusionPricingIssueKind;
  detail: string;
  expected: string;
  actual: string;
  /**
   * docs/AUDITORIA-MOTOR-PRECIOS-COSTOS.md, hallazgo #2 — solo poblados
   * para UNSELLABLE (único kind con un precio/costo limpio de un solo
   * producto; los demás kinds mezclan varios productId o no tienen un par
   * precio/costo comparable). pricing-detector.ts los copia a evidenceJson
   * para que tray-service.ts pueda armar una fila de Bandeja sin volver a
   * consultar precio/costo.
   */
  effectivePrice?: number;
  effectiveCost?: number;
};

export type FusionPricingHealthResult = {
  stockGroupId: string;
  stockGroupCode: string;
  healthy: boolean;
  issues: FusionPricingIssue[];
};

function marginPercent(price: Prisma.Decimal, cost: Prisma.Decimal): number | null {
  if (price.lte(0)) return null;
  return Number(price.sub(cost).div(price));
}

export async function checkStockGroupPricingHealth(
  db: DbClient,
  input: { stockGroupId: string; branchIds?: string[] },
): Promise<FusionPricingHealthResult> {
  const group = await db.productStockGroup.findUnique({
    where: { id: input.stockGroupId },
    include: {
      products: {
        where: { isActive: true },
        select: { productId: true, isCanonical: true, conversionFactor: true },
      },
    },
  });
  if (!group) return { stockGroupId: input.stockGroupId, stockGroupCode: "", healthy: true, issues: [] };

  const canonical = group.products.find((m) => m.isCanonical);
  if (!canonical) return { stockGroupId: group.id, stockGroupCode: group.code, healthy: true, issues: [] };

  const allProductIds = group.products.map((m) => m.productId);

  let branchIds = input.branchIds;
  if (!branchIds) {
    const [balances, settings] = await Promise.all([
      db.inventoryBalance.findMany({ where: { productId: { in: allProductIds } }, select: { branchId: true } }),
      db.branchProductSetting.findMany({ where: { productId: { in: allProductIds } }, select: { branchId: true } }),
    ]);
    branchIds = [...new Set([...balances.map((b) => b.branchId), ...settings.map((s) => s.branchId)])];
  }
  if (branchIds.length === 0) return { stockGroupId: group.id, stockGroupCode: group.code, healthy: true, issues: [] };

  const issues: FusionPricingIssue[] = [];

  // ── UNSELLABLE / MARGIN_OUTLIER / PLACEHOLDER_COST: sobre el precio y
  // costo EFECTIVOS (ya corregidos por fusión) — lo que el POS realmente
  // usaría hoy para vender.
  const pricingItems = branchIds.flatMap((branchId) => allProductIds.map((productId) => ({ branchId, productId })));
  const pricingByKey = await getEffectiveProductPricingBatch(db, pricingItems);

  const canonicalBalances = await db.inventoryBalance.findMany({
    where: { productId: canonical.productId, branchId: { in: branchIds } },
    select: { branchId: true, quantityOnHand: true },
  });
  const canonicalStockByBranch = new Map(canonicalBalances.map((b) => [b.branchId, b.quantityOnHand]));

  for (const branchId of branchIds) {
    for (const member of group.products) {
      const pricing = pricingByKey.get(`${branchId}:${member.productId}`);
      if (!pricing) continue;

      // PLACEHOLDER_COST solo depende del COSTO — no debe quedar condicionado
      // a que el canónico también tenga un precio propio seteado (un
      // canónico sin branchPrice, resolviendo effectivePrice=null, seguiría
      // siendo tan sospechoso con costo C$1 y stock real).
      if (member.isCanonical && pricing.effectiveCost !== null) {
        const stock = canonicalStockByBranch.get(branchId);
        const isPlaceholder = PLACEHOLDER_COST_VALUES.some((v) => pricing.effectiveCost!.sub(v).abs().lte(PLACEHOLDER_EPSILON));
        if (isPlaceholder && stock && stock.gt(0)) {
          issues.push({
            branchId,
            productId: member.productId,
            kind: "PLACEHOLDER_COST",
            detail: `canónico con stock (${stock.toString()}) y costo efectivo ${pricing.effectiveCost.toString()} — casi seguro un valor de relleno, no un costo real`,
            expected: "costo real de adquisición",
            actual: pricing.effectiveCost.toString(),
          });
        }
      }

      // UNSELLABLE / MARGIN_OUTLIER sí necesitan precio Y costo resueltos —
      // sin precio propio ni implícito de fusión no hay nada que comparar.
      if (pricing.effectivePrice === null || pricing.effectiveCost === null) continue;

      if (pricing.effectivePrice.lt(pricing.effectiveCost)) {
        issues.push({
          branchId,
          productId: member.productId,
          kind: "UNSELLABLE",
          detail: "precio efectivo < costo efectivo — el guard BELOW_COST_NOT_ALLOWED va a bloquear la venta en el mostrador",
          expected: `precio >= ${pricing.effectiveCost.toString()}`,
          actual: pricing.effectivePrice.toString(),
          effectivePrice: pricing.effectivePrice.toNumber(),
          effectiveCost: pricing.effectiveCost.toNumber(),
        });
      }

      const margin = marginPercent(pricing.effectivePrice, pricing.effectiveCost);
      if (margin !== null && (margin < 0 || margin > MARGIN_OUTLIER_HIGH_THRESHOLD)) {
        issues.push({
          branchId,
          productId: member.productId,
          kind: "MARGIN_OUTLIER",
          detail: margin < 0 ? "margen negativo" : `margen absurdamente alto (>${Math.round(MARGIN_OUTLIER_HIGH_THRESHOLD * 100)}%) — típico síntoma de costo de relleno`,
          expected: `0% <= margen <= ${Math.round(MARGIN_OUTLIER_HIGH_THRESHOLD * 100)}%`,
          actual: `${Math.round(margin * 10000) / 100}%`,
        });
      }
    }
  }

  // ── COST_BASIS_CONFLICT / PRICE_BASIS_CONFLICT: sobre los campos PROPIOS
  // de cada miembro (ignorados por resolveEffectivePricing para el costo,
  // pero pueden seguir ahí como dato corrupto sin limpiar) — lo que esta
  // auditoría existe para encontrar y que alguien limpie (§3/§4 del doc).
  const [ownProducts, ownSettings] = await Promise.all([
    db.product.findMany({
      where: { id: { in: allProductIds } },
      select: { id: true, globalCost: true, averageCost: true, lastPurchaseCost: true },
    }),
    db.branchProductSetting.findMany({
      where: { productId: { in: allProductIds }, branchId: { in: branchIds } },
      select: { branchId: true, productId: true, branchCost: true, branchPrice: true },
    }),
  ]);
  const ownProductById = new Map(ownProducts.map((p) => [p.id, p]));
  const ownSettingByKey = new Map(ownSettings.map((s) => [`${s.branchId}:${s.productId}`, s]));
  const factorByProductId = new Map(group.products.map((m) => [m.productId, m.conversionFactor]));

  for (const branchId of branchIds) {
    const impliedBaseCosts: Array<{ productId: string; value: Prisma.Decimal }> = [];
    const impliedBasePrices: Array<{ productId: string; value: Prisma.Decimal }> = [];

    for (const member of group.products) {
      const factor = factorByProductId.get(member.productId) ?? new Prisma.Decimal(1);
      if (factor.lte(0)) continue;
      const ownProduct = ownProductById.get(member.productId);
      const ownSetting = ownSettingByKey.get(`${branchId}:${member.productId}`);

      const { cost } = resolveCostChain({
        branchCost: ownSetting?.branchCost ?? null,
        averageCost: ownProduct?.averageCost ?? null,
        globalCost: ownProduct?.globalCost ?? null,
        lastPurchaseCost: ownProduct?.lastPurchaseCost ?? null,
        weightedAverageCost: null, // el WAC ya vive resuelto en pricingByKey; acá solo miran campos propios corruptibles
      });
      if (cost !== null) impliedBaseCosts.push({ productId: member.productId, value: cost.div(factor) });

      if (ownSetting?.branchPrice) {
        impliedBasePrices.push({ productId: member.productId, value: ownSetting.branchPrice.div(factor) });
      }
    }

    for (const [kind, list] of [["COST_BASIS_CONFLICT", impliedBaseCosts], ["PRICE_BASIS_CONFLICT", impliedBasePrices]] as const) {
      if (list.length < 2) continue;
      const max = list.reduce((a, b) => (b.value.gt(a.value) ? b : a));
      const min = list.reduce((a, b) => (b.value.lt(a.value) ? b : a));
      if (max.value.eq(min.value)) continue;
      const deviation = min.value.gt(0) ? max.value.sub(min.value).div(min.value).toNumber() : null;
      if (deviation !== null && deviation > FUSION_BASIS_CONFLICT_TOLERANCE) {
        issues.push({
          branchId,
          productId: list.map((i) => i.productId).join(", "),
          kind,
          detail: `${list.length} presentaciones implican una base ${kind === "COST_BASIS_CONFLICT" ? "de costo" : "de precio"} distinta más allá de tolerancia (${Math.round(FUSION_BASIS_CONFLICT_TOLERANCE * 100)}%)`,
          expected: `${min.productId}=${min.value.toString()} ≈ ${max.productId}=${max.value.toString()}`,
          actual: `desvío ${Math.round(deviation * 10000) / 100}%`,
        });
      }
    }
  }

  return { stockGroupId: group.id, stockGroupCode: group.code, healthy: issues.length === 0, issues };
}
