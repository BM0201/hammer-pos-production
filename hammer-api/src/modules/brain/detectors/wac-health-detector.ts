import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";
import { getProductStockConversionsBatch } from "@/modules/inventory/unit-conversion";
import { riskScoreFor, severityForDeviation } from "@/modules/brain/scoring";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";

/**
 * docs/WAC-DESACTIVADO.md — auditoría PROACTIVA de salud del WAC, para
 * correr ANTES de reactivar wac_drives_cost_chain: que las contaminaciones
 * tipo hierro (WAC C$2900 contra venta C$1890) o arena (factor de fusión
 * mal cargado, WAC 18.6× el real) se descubran TODAS de una vez recorriendo
 * el catálogo, no una por una cuando alguien las tropieza en Catálogo o
 * Inventario. Solo lectura — no toca wac.ts/unit-conversion.ts/
 * recalculateWeightedAverage ni el flag; el WAC se sigue calculando exacto
 * igual, esto solo lo vigila.
 *
 * Los 3 umbrales son deliberadamente distintos entre sí — mismo principio
 * que cash-monitor.ts: cada decisión dice CONTRA QUÉ se comparó y con qué
 * margen, nunca un número con aire de certeza que nadie puede verificar.
 */

function n(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

/* ── Regla 1 — VENTA_POR_DEBAJO_DE_WAC ───────────────────────────────────
 * El caso hierro: WAC C$2900 contra un precio de venta vigente de C$1890 —
 * vender por debajo de lo que costó. Mismo umbral (15%) que ya usa
 * fix-fusion-canonical-cost.ts (FACTOR_TOLERANCE) para "esto se parece
 * demasiado/difiere demasiado" — no se inventa un número nuevo. */

export const WAC_ABOVE_PRICE_TOLERANCE = 0.15;

export type WacAbovePriceCheck = {
  isSuspicious: boolean;
  /** (wac − precio) / precio. null sin precio efectivo contra qué comparar. */
  excessPercent: number | null;
};

export function evaluateWacAgainstSalePrice(input: { wac: number; effectivePrice: number | null }): WacAbovePriceCheck {
  if (input.effectivePrice === null || input.effectivePrice <= 0) return { isSuspicious: false, excessPercent: null };
  const excessPercent = (input.wac - input.effectivePrice) / input.effectivePrice;
  return { isSuspicious: excessPercent > WAC_ABOVE_PRICE_TOLERANCE, excessPercent };
}

/* ── Regla 2 — WAC_SE_ALEJA_DEL_COSTO_CHAIN ──────────────────────────────
 * El WAC se compara contra averageCost > globalCost > lastPurchaseCost (el
 * que exista, en ese orden) — nunca contra branchCost (es una declaración
 * manual, no un costo observado/calculado, así que no sirve de referencia
 * independiente para saber si el WAC está bien). Umbral más laxo (30%) que
 * la regla 1 porque WAC y costo global pueden divergir legítimamente por
 * compras recientes a precio distinto — esto es solo para los casos
 * extremos. */

export const WAC_VS_COST_CHAIN_TOLERANCE = 0.30;

export type CostChainReferenceSource = "averageCost" | "globalCost" | "lastPurchaseCost";

export function pickCostChainReference(input: {
  averageCost: number | null;
  globalCost: number | null;
  lastPurchaseCost: number | null;
}): { cost: number | null; source: CostChainReferenceSource | null } {
  if (input.averageCost !== null && input.averageCost > 0) return { cost: input.averageCost, source: "averageCost" };
  if (input.globalCost !== null && input.globalCost > 0) return { cost: input.globalCost, source: "globalCost" };
  if (input.lastPurchaseCost !== null && input.lastPurchaseCost > 0) return { cost: input.lastPurchaseCost, source: "lastPurchaseCost" };
  return { cost: null, source: null };
}

export type WacVsCostChainCheck = {
  isSuspicious: boolean;
  deviationPercent: number | null;
  referenceCost: number | null;
  referenceSource: CostChainReferenceSource | null;
};

export function evaluateWacAgainstCostChain(input: {
  wac: number;
  averageCost: number | null;
  globalCost: number | null;
  lastPurchaseCost: number | null;
}): WacVsCostChainCheck {
  const { cost: referenceCost, source: referenceSource } = pickCostChainReference(input);
  if (referenceCost === null) return { isSuspicious: false, deviationPercent: null, referenceCost: null, referenceSource: null };
  const deviationPercent = Math.abs(input.wac - referenceCost) / referenceCost;
  return { isSuspicious: deviationPercent > WAC_VS_COST_CHAIN_TOLERANCE, deviationPercent, referenceCost, referenceSource };
}

/* ── Regla 3 — WAC_DIFIERE_ENTRE_SUCURSALES_HERMANAS ─────────────────────
 * Mismo tipo de comparación que ya hace fix-fusion-canonical-cost.ts
 * --source=sibling-branch, pero disparada sola en vez de que alguien la
 * pida a mano. Se compara contra el PROMEDIO de las sucursales hermanas
 * (no contra una sola) — con 2+ hermanas, una sola sucursal rara no basta
 * para acusar a las demás. Umbral 40%: más laxo que la regla 2 porque
 * compras en fechas distintas por sucursal son normales. */

export const WAC_SIBLING_BRANCH_TOLERANCE = 0.40;

export type WacSiblingBranchCheck = {
  isSuspicious: boolean;
  deviationPercent: number | null;
  siblingAverageWac: number | null;
  siblingCount: number;
};

export function evaluateWacAgainstSiblingBranches(input: { wac: number; siblingWacs: number[] }): WacSiblingBranchCheck {
  const usable = input.siblingWacs.filter((w) => w > 0);
  if (usable.length === 0) return { isSuspicious: false, deviationPercent: null, siblingAverageWac: null, siblingCount: 0 };
  const siblingAverageWac = usable.reduce((a, b) => a + b, 0) / usable.length;
  const deviationPercent = Math.abs(input.wac - siblingAverageWac) / siblingAverageWac;
  return { isSuspicious: deviationPercent > WAC_SIBLING_BRANCH_TOLERANCE, deviationPercent, siblingAverageWac, siblingCount: usable.length };
}

/* ── Detector (DB) ────────────────────────────────────────────────────── */

export async function detectWacHealthDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];

  const balances = await prisma.inventoryBalance.findMany({
    where: {
      weightedAverageCost: { gt: 0 },
      ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      product: { is: { isActive: true } },
      branch: { is: { isActive: true } },
    },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      product: { select: { id: true, sku: true, name: true } },
    },
    take: Math.min(1000, ctx.limits.maxEntities),
    orderBy: { updatedAt: "desc" },
  });
  if (balances.length === 0) return decisions;

  const pairs = balances.map((b) => ({ branchId: b.branchId, productId: b.productId }));
  const pricingByKey = await getEffectiveProductPricingBatch(prisma, pairs);

  // Regla 3 — hermanas: se resuelve el canónico de CADA producto candidato
  // (getProductStockConversionsBatch, sin reimplementar la resolución de
  // fusión) y luego se trae el balance real de ESE canónico en TODAS las
  // sucursales (no solo las que ctx.branchId scopeó) — sin esto, escanear
  // una sola sucursal nunca vería a sus hermanas.
  const productIds = [...new Set(balances.map((b) => b.productId))];
  const conversionByProductId = await getProductStockConversionsBatch(prisma, productIds);
  const canonicalIdByProductId = new Map(
    productIds.map((id) => [id, conversionByProductId.get(id)?.canonicalProductId ?? id]),
  );
  const canonicalIds = [...new Set(canonicalIdByProductId.values())];
  const siblingBalances = await prisma.inventoryBalance.findMany({
    where: { productId: { in: canonicalIds }, weightedAverageCost: { gt: 0 }, branch: { is: { isActive: true } } },
    select: { productId: true, branchId: true, weightedAverageCost: true, branch: { select: { code: true } } },
  });
  const siblingsByCanonicalId = new Map<string, Array<{ branchId: string; branchCode: string; wac: number }>>();
  for (const row of siblingBalances) {
    const list = siblingsByCanonicalId.get(row.productId) ?? [];
    list.push({ branchId: row.branchId, branchCode: row.branch.code, wac: n(row.weightedAverageCost) });
    siblingsByCanonicalId.set(row.productId, list);
  }

  for (const balance of balances) {
    const key = `${balance.branchId}:${balance.productId}`;
    const effective = pricingByKey.get(key);
    if (!effective) continue;
    const wac = n(balance.weightedAverageCost);
    const label = `${balance.product.sku} - ${balance.product.name}`;
    const stockQty = n(balance.quantityOnHand);

    // Regla 1 — venta por debajo del WAC.
    const priceCheck = evaluateWacAgainstSalePrice({ wac, effectivePrice: effective.effectivePrice === null ? null : n(effective.effectivePrice) });
    if (priceCheck.isSuspicious && priceCheck.excessPercent !== null) {
      const severity = severityForDeviation(priceCheck.excessPercent, WAC_ABOVE_PRICE_TOLERANCE);
      const effectivePriceNum = n(effective.effectivePrice);
      decisions.push({
        category: "INVENTORY",
        severity,
        title: `WAC por encima del precio de venta: ${label}`,
        description: `${balance.branch.code}: WAC C$${wac.toFixed(2)} supera el precio de venta vigente C$${effectivePriceNum.toFixed(2)} por ${(priceCheck.excessPercent * 100).toFixed(1)}% — umbral ${(WAC_ABOVE_PRICE_TOLERANCE * 100).toFixed(0)}%.`,
        recommendation: "Revisar si el WAC está contaminado (factor de fusión, movimiento mal tecleado) antes de reactivar wac_drives_cost_chain — con el flag prendido, este producto se vendería a pérdida.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.88,
        impactAmount: stockQty * Math.max(0, wac - effectivePriceNum),
        riskScore: riskScoreFor(severity, 0.88),
        proposedActionType: "REVIEW_WAC_BELOW_SALE_PRICE",
        evidenceJson: {
          rule: "VENTA_POR_DEBAJO_DE_WAC",
          wac,
          effectivePrice: effectivePriceNum,
          priceSource: effective.priceSource,
          excessPercent: priceCheck.excessPercent,
          tolerancePercent: WAC_ABOVE_PRICE_TOLERANCE,
          comparedAgainst: "effectivePrice (branchPrice ?? standardSalePrice)",
          stockAtRisk: stockQty,
        },
        sourceJson: { detector: "wac-health-detector" },
        fingerprintParts: ["wac-health", "above-sale-price", balance.branchId, balance.productId],
      });
    }

    // Regla 2 — el WAC se aleja de la cadena de costo sin WAC.
    const costChainCheck = evaluateWacAgainstCostChain({
      wac,
      averageCost: effective.averageCost === null || effective.averageCost === undefined ? null : n(effective.averageCost),
      globalCost: effective.globalCost === null || effective.globalCost === undefined ? null : n(effective.globalCost),
      lastPurchaseCost: effective.lastPurchaseCost === null || effective.lastPurchaseCost === undefined ? null : n(effective.lastPurchaseCost),
    });
    if (costChainCheck.isSuspicious && costChainCheck.deviationPercent !== null && costChainCheck.referenceCost !== null) {
      const severity = severityForDeviation(costChainCheck.deviationPercent, WAC_VS_COST_CHAIN_TOLERANCE);
      decisions.push({
        category: "INVENTORY",
        severity,
        title: `WAC se aleja del costo registrado: ${label}`,
        description: `${balance.branch.code}: WAC C$${wac.toFixed(2)} se desvía ${(costChainCheck.deviationPercent * 100).toFixed(1)}% de ${costChainCheck.referenceSource} (C$${costChainCheck.referenceCost.toFixed(2)}) — umbral ${(WAC_VS_COST_CHAIN_TOLERANCE * 100).toFixed(0)}%.`,
        recommendation: "Comparar contra facturas de compra reales antes de reactivar wac_drives_cost_chain — una desviación así de grande suele ser un factor de conversión mal cargado.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.8,
        impactAmount: stockQty * Math.abs(wac - costChainCheck.referenceCost),
        riskScore: riskScoreFor(severity, 0.8),
        proposedActionType: "REVIEW_WAC_VS_COST_CHAIN_DEVIATION",
        evidenceJson: {
          rule: "WAC_SE_ALEJA_DEL_COSTO_CHAIN",
          wac,
          referenceCost: costChainCheck.referenceCost,
          referenceSource: costChainCheck.referenceSource,
          deviationPercent: costChainCheck.deviationPercent,
          tolerancePercent: WAC_VS_COST_CHAIN_TOLERANCE,
          comparedAgainst: "averageCost > globalCost > lastPurchaseCost (el que exista)",
          stockAtRisk: stockQty,
        },
        sourceJson: { detector: "wac-health-detector" },
        fingerprintParts: ["wac-health", "vs-cost-chain", balance.branchId, balance.productId],
      });
    }

    // Regla 3 — el WAC difiere de las sucursales hermanas.
    const canonicalId = canonicalIdByProductId.get(balance.productId) ?? balance.productId;
    const siblings = (siblingsByCanonicalId.get(canonicalId) ?? []).filter((s) => s.branchId !== balance.branchId);
    const siblingCheck = evaluateWacAgainstSiblingBranches({ wac, siblingWacs: siblings.map((s) => s.wac) });
    if (siblingCheck.isSuspicious && siblingCheck.deviationPercent !== null && siblingCheck.siblingAverageWac !== null) {
      const severity = severityForDeviation(siblingCheck.deviationPercent, WAC_SIBLING_BRANCH_TOLERANCE);
      decisions.push({
        category: "INVENTORY",
        severity,
        title: `WAC distinto entre sucursales: ${label}`,
        description: `${balance.branch.code}: WAC C$${wac.toFixed(2)} se desvía ${(siblingCheck.deviationPercent * 100).toFixed(1)}% del promedio de ${siblingCheck.siblingCount} sucursal(es) hermana(s) (C$${siblingCheck.siblingAverageWac.toFixed(2)}: ${siblings.map((s) => `${s.branchCode}=C$${s.wac.toFixed(2)}`).join(", ")}) — umbral ${(WAC_SIBLING_BRANCH_TOLERANCE * 100).toFixed(0)}%.`,
        recommendation: "Confirmar si la diferencia es una compra real más cara/barata en esta sucursal o un dato contaminado — mismo chequeo que fix-fusion-canonical-cost.ts --source=sibling-branch, acá disparado solo.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.72,
        impactAmount: stockQty * Math.abs(wac - siblingCheck.siblingAverageWac),
        riskScore: riskScoreFor(severity, 0.72),
        proposedActionType: "REVIEW_WAC_SIBLING_BRANCH_DEVIATION",
        evidenceJson: {
          rule: "WAC_DIFIERE_ENTRE_SUCURSALES_HERMANAS",
          wac,
          siblingAverageWac: siblingCheck.siblingAverageWac,
          siblingBranches: siblings.map((s) => ({ branchCode: s.branchCode, wac: s.wac })),
          deviationPercent: siblingCheck.deviationPercent,
          tolerancePercent: WAC_SIBLING_BRANCH_TOLERANCE,
          comparedAgainst: "promedio del WAC de las sucursales hermanas del mismo producto (o su canónico, si es fusión)",
          stockAtRisk: stockQty,
        },
        sourceJson: { detector: "wac-health-detector" },
        fingerprintParts: ["wac-health", "sibling-branch-deviation", balance.branchId, balance.productId],
      });
    }
  }

  return decisions;
}
