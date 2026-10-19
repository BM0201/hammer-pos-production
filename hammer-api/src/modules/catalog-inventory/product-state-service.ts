import { Prisma, PrismaClient } from "@prisma/client";
import { getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";
import { computeMarginPercent } from "@/modules/pricing/price-math";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * prompt-inventario-v3.md Fase 1 — estado precalculado por producto y
 * sucursal. UN SOLO ESCRITOR: todo lo demás (lista, overview, Resumen de la
 * ficha) solo LEE ProductBranchState/ProductCatalogState, nunca recalcula.
 *
 * Mismo fallback que isCriticalStock (catalog-inventory/service.ts) para
 * "stock bajo" sin ninguna StockReorderPolicy activa: 1, no 0 — un producto
 * sin política configurada igual avisa si se queda en una sola unidad.
 */
const CRITICAL_STOCK_FALLBACK = 1;

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export type ProductStockStatusValue = "NEGATIVE" | "ZERO" | "LOW" | "OK";

export function computeStockStatus(quantityOnHand: number, reorderPoint: number | null): ProductStockStatusValue {
  if (quantityOnHand < 0) return "NEGATIVE";
  if (quantityOnHand === 0) return "ZERO";
  if (quantityOnHand <= (reorderPoint ?? CRITICAL_STOCK_FALLBACK)) return "LOW";
  return "OK";
}

type ProductBranchPair = { productId: string; branchId: string };

/**
 * Qué pares (producto, sucursal) importan para estos productos cuando el
 * caller no los sabe de antemano (p.ej. un alta de código, que no es
 * específica de ninguna sucursal) — "donde ya hay alguna señal": balance,
 * configuración de sucursal o política de reorden. Un producto recién
 * creado, sin ninguna de las tres, no genera ninguna fila todavía — se
 * crea sola en cuanto algo la toque (mismo patrón perezoso que
 * InventoryBalance, que tampoco se pre-crea al dar de alta un producto).
 */
async function discoverRelevantPairs(db: Db, productIds: string[]): Promise<ProductBranchPair[]> {
  // Secuencial a propósito, no Promise.all: si una de las tres llamadas
  // revienta sincrónicamente (p.ej. un mock de test incompleto), un
  // Promise.all con elementos que se evalúan antes del que falla deja esas
  // promesas ya creadas SIN NADIE que les ponga un .catch — Node las marca
  // "unhandled rejection" aunque el llamador de refreshProductStateTx sí
  // atrape el error agregado. Secuencial evita ese huérfano por completo.
  const balances = await db.inventoryBalance.findMany({ where: { productId: { in: productIds } }, select: { productId: true, branchId: true } });
  const settings = await db.branchProductSetting.findMany({ where: { productId: { in: productIds } }, select: { productId: true, branchId: true } });
  const policies = await db.stockReorderPolicy.findMany({ where: { productId: { in: productIds } }, select: { productId: true, branchId: true } });
  const seen = new Set<string>();
  const pairs: ProductBranchPair[] = [];
  for (const row of [...balances, ...settings, ...policies]) {
    const key = `${row.productId}:${row.branchId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ productId: row.productId, branchId: row.branchId });
  }
  return pairs;
}

/**
 * El único escritor de ProductBranchState/ProductCatalogState. Reusa
 * getEffectiveProductPricingBatch (catalog/effective-pricing.ts) para
 * costo/precio/margen — fusión incluida, NUNCA una cadena de costo propia —
 * y StockReorderPolicy para mínimo/punto de reorden, la MISMA fuente que
 * usa hoy isCriticalStock en catalog-inventory/service.ts (no
 * BranchProductSetting.minStock/reorderPoint, que es un sistema de umbral
 * DISTINTO que usa Reposición v2/Producción — ver nota en
 * docs/PENDIENTES.md tras esta fase).
 *
 * `units90d`/`revenue90d` NO se tocan acá (recomputarlos en cada escritura
 * sería caro) — se incrementan en la venta (incrementProductSales90dTx,
 * más abajo) y se reconcilian de verdad una vez por noche.
 *
 * `quantityOnHand` espeja InventoryBalance 1:1 por (productId, branchId):
 * un miembro DERIVADO de una fusión no tiene su propia fila de balance (vive
 * en el canónico) y por lo tanto sale en 0 acá — igual que hoy. El stock
 * dual por fusión (formatDualStock) sigue siendo un cálculo de
 * PRESENTACIÓN en la capa de lista/ficha, no algo que este estado resuelva.
 */
export async function refreshProductStateTx(db: Db, productIds: string[], branchIds?: string[]): Promise<void> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return;

  const pairs = branchIds && branchIds.length > 0
    ? ids.flatMap((productId) => [...new Set(branchIds)].map((branchId) => ({ productId, branchId })))
    : await discoverRelevantPairs(db, ids);

  if (pairs.length > 0) {
    // Secuencial a propósito — ver nota en discoverRelevantPairs.
    const pricingByKey = await getEffectiveProductPricingBatch(db, pairs);
    const balanceRows = await db.inventoryBalance.findMany({
      where: { OR: pairs.map((p) => ({ productId: p.productId, branchId: p.branchId })) },
      select: { productId: true, branchId: true, quantityOnHand: true },
    });
    const policyRows = await db.stockReorderPolicy.findMany({
      where: { OR: pairs.map((p) => ({ productId: p.productId, branchId: p.branchId })), isActive: true },
      select: { productId: true, branchId: true, minQuantity: true, reorderPoint: true },
    });

    const balanceByKey = new Map(balanceRows.map((b) => [`${b.productId}:${b.branchId}`, b]));
    const policyByKey = new Map(policyRows.map((p) => [`${p.productId}:${p.branchId}`, p]));
    const now = new Date();

    for (const pair of pairs) {
      const key = `${pair.productId}:${pair.branchId}`;
      // getEffectiveProductPricingBatch devuelve su mapa con la clave al
      // revés (branchId:productId, ver effective-pricing.ts) — ojo acá, no
      // es el mismo orden que balanceByKey/policyByKey de abajo (ambos
      // construidos por este archivo, en el orden que usamos en todos
      // lados: productId:branchId).
      const pricing = pricingByKey.get(`${pair.branchId}:${pair.productId}`);
      const policy = policyByKey.get(key);
      const quantityOnHand = decimalToNumber(balanceByKey.get(key)?.quantityOnHand);
      const effectiveCost = pricing?.effectiveCost ? decimalToNumber(pricing.effectiveCost) : null;
      const effectivePrice = pricing?.effectivePrice ? decimalToNumber(pricing.effectivePrice) : null;
      const reorderPoint = policy ? decimalToNumber(policy.reorderPoint) : null;

      const data = {
        quantityOnHand: new Prisma.Decimal(quantityOnHand),
        effectiveCost: effectiveCost !== null ? new Prisma.Decimal(effectiveCost) : null,
        costSource: pricing?.costSource ?? null,
        effectivePrice: effectivePrice !== null ? new Prisma.Decimal(effectivePrice) : null,
        priceSource: pricing?.priceSource ?? null,
        marginPercent: (() => {
          const margin = computeMarginPercent(effectiveCost, effectivePrice);
          return margin === null ? null : new Prisma.Decimal(margin);
        })(),
        minQuantity: policy ? new Prisma.Decimal(decimalToNumber(policy.minQuantity)) : null,
        reorderPoint: reorderPoint !== null ? new Prisma.Decimal(reorderPoint) : null,
        stockStatus: computeStockStatus(quantityOnHand, reorderPoint),
        lastMovementAt: now,
      };

      await db.productBranchState.upsert({
        where: { productId_branchId: { productId: pair.productId, branchId: pair.branchId } },
        create: { productId: pair.productId, branchId: pair.branchId, ...data, units90d: new Prisma.Decimal(0), revenue90d: new Prisma.Decimal(0) },
        update: data,
      });
    }
  }

  await refreshCatalogStateTx(db, ids);
}

/**
 * ProductCatalogState (una fila por producto, no por sucursal) — se
 * recalcula leyendo TODAS las filas ProductBranchState del producto (no
 * solo las tocadas en esta llamada), porque "tiene costo en alguna
 * sucursal" depende de sucursales que puede que esta llamada ni haya
 * tocado.
 */
async function refreshCatalogStateTx(db: Db, productIds: string[]): Promise<void> {
  // Secuencial a propósito — ver nota en discoverRelevantPairs.
  const products = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, barcode: true, standardSalePrice: true } });
  const states = await db.productBranchState.findMany({ where: { productId: { in: productIds } }, select: { productId: true, quantityOnHand: true, effectiveCost: true, effectivePrice: true } });

  const statesByProduct = new Map<string, typeof states>();
  for (const state of states) {
    const list = statesByProduct.get(state.productId) ?? [];
    list.push(state);
    statesByProduct.set(state.productId, list);
  }

  for (const product of products) {
    const productStates = statesByProduct.get(product.id) ?? [];
    const totalQuantity = productStates.reduce((sum, s) => sum + decimalToNumber(s.quantityOnHand), 0);
    const hasCost = productStates.some((s) => s.effectiveCost !== null && decimalToNumber(s.effectiveCost) > 0);
    const standardSalePrice = decimalToNumber(product.standardSalePrice);
    const hasBranchPrice = productStates.some((s) => s.effectivePrice !== null && decimalToNumber(s.effectivePrice) > 0);
    const hasPrice = standardSalePrice > 0 || hasBranchPrice;
    const costEqualsPrice = productStates.some((s) => {
      const cost = s.effectiveCost !== null ? decimalToNumber(s.effectiveCost) : null;
      const price = s.effectivePrice !== null ? decimalToNumber(s.effectivePrice) : null;
      return cost !== null && price !== null && cost > 0 && cost === price;
    });

    await db.productCatalogState.upsert({
      where: { productId: product.id },
      create: {
        productId: product.id,
        hasCode: product.barcode !== null,
        hasCost,
        hasPrice,
        costEqualsPrice,
        totalQuantity: new Prisma.Decimal(totalQuantity),
      },
      update: {
        hasCode: product.barcode !== null,
        hasCost,
        hasPrice,
        costEqualsPrice,
        totalQuantity: new Prisma.Decimal(totalQuantity),
      },
    });
  }
}

/**
 * "Incremento por venta" (Fase 1.3) — units90d/revenue90d NO se recalculan
 * leyendo 90 días de historial en cada venta (caro); se suman directo. La
 * reconciliación nocturna (cron cleanup) corrige cualquier desvío (ventana
 * que envejece, devoluciones, anulaciones).
 */
export async function incrementProductSales90dTx(
  db: Db,
  items: Array<{ productId: string; branchId: string; unitsDelta: number; revenueDelta: number }>,
): Promise<void> {
  for (const item of items) {
    if (item.unitsDelta === 0 && item.revenueDelta === 0) continue;
    await db.productBranchState.upsert({
      where: { productId_branchId: { productId: item.productId, branchId: item.branchId } },
      create: {
        productId: item.productId,
        branchId: item.branchId,
        units90d: new Prisma.Decimal(Math.max(0, item.unitsDelta)),
        revenue90d: new Prisma.Decimal(Math.max(0, item.revenueDelta)),
      },
      update: {
        units90d: { increment: new Prisma.Decimal(item.unitsDelta) },
        revenue90d: { increment: new Prisma.Decimal(item.revenueDelta) },
      },
    });
  }
}
