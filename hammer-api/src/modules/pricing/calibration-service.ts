import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";
import { getBranchPolicyDefaults } from "@/modules/pricing/category-policy-service";
import { computeRealizedMarginBatch, realizedMarginUsable } from "@/modules/pricing/tray-context-service";

/**
 * Parte C.3 (prompt-completo-pendientes-2026-10.md) — "calibrar con ventas
 * reales": antes de pedirle al dueño que invente un mínimo/meta de
 * margen, se le muestra lo que YA está pasando (margen realmente vendido
 * por categoría, 90 días) y cuántos productos caerían en la Bandeja con
 * cada umbral candidato. Nada se cambia solo — el dueño confirma.
 */

/** Percentil por rango más cercano sobre un array YA ordenado ascendente. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[index];
}

export type CategoryCalibrationRow = {
  categoryId: string;
  categoryName: string;
  productsWithData: number;
  totalProducts: number;
  totalUnits90d: number;
  realizedMarginP25: number | null;
  realizedMarginMedian: number | null;
  realizedMarginP75: number | null;
  currentMinMarginPercent: number;
  currentTargetMarginPercent: number;
  wouldBeInTrayAtCurrentMin: number;
  wouldBeInTrayAtP25: number;
  wouldBeInTrayAtMedian: number;
  wouldBeInTrayAtP75: number;
};

/** Pura — separada para poder probar la agregación/percentiles con números a mano, sin base de datos. */
export function buildCategoryCalibration(input: {
  categoryId: string;
  categoryName: string;
  currentMinMarginPercent: number;
  currentTargetMarginPercent: number;
  products: Array<{ effectiveMarginPct: number | null; realizedMarginPct: number | null; units90d: number }>;
}): CategoryCalibrationRow {
  const realized = input.products.map((p) => p.realizedMarginPct).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const p25 = percentile(realized, 0.25);
  const median = percentile(realized, 0.5);
  const p75 = percentile(realized, 0.75);

  const effectiveMargins = input.products.map((p) => p.effectiveMarginPct).filter((v): v is number => v !== null);
  const countBelow = (threshold: number | null) => (threshold === null ? 0 : effectiveMargins.filter((m) => m < threshold).length);

  return {
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    productsWithData: realized.length,
    totalProducts: input.products.length,
    totalUnits90d: input.products.reduce((sum, p) => sum + p.units90d, 0),
    realizedMarginP25: p25,
    realizedMarginMedian: median,
    realizedMarginP75: p75,
    currentMinMarginPercent: input.currentMinMarginPercent,
    currentTargetMarginPercent: input.currentTargetMarginPercent,
    wouldBeInTrayAtCurrentMin: countBelow(input.currentMinMarginPercent),
    wouldBeInTrayAtP25: countBelow(p25),
    wouldBeInTrayAtMedian: countBelow(median),
    wouldBeInTrayAtP75: countBelow(p75),
  };
}

export async function getPricingCalibration(input: { branchId: string }, db: typeof prisma = prisma): Promise<{ categories: CategoryCalibrationRow[] }> {
  const balances = await db.inventoryBalance.findMany({
    where: { branchId: input.branchId, product: { is: { isActive: true } } },
    select: { productId: true, product: { select: { categoryId: true, category: { select: { name: true } } } } },
  });
  if (balances.length === 0) return { categories: [] };

  const pairs = balances.map((b) => ({ branchId: input.branchId, productId: b.productId }));
  const [effectiveByKey, realizedByKey, units90dRows, categoryPolicies, branchDefaults] = await Promise.all([
    getEffectiveProductPricingBatch(db, pairs),
    computeRealizedMarginBatch(db, pairs),
    db.saleOrderLine.groupBy({
      by: ["productId"],
      where: {
        productId: { in: balances.map((b) => b.productId) },
        saleOrder: { branchId: input.branchId, status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] }, createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
      },
      _sum: { quantity: true },
    }),
    db.branchCategoryPricingPolicy.findMany({ where: { branchId: input.branchId }, select: { categoryId: true, minMarginPercent: true, targetMarginPercent: true } }),
    getBranchPolicyDefaults(db, input.branchId),
  ]);

  const units90dByProduct = new Map(units90dRows.map((r) => [r.productId, Number(r._sum.quantity ?? 0)]));
  const policyByCategory = new Map(categoryPolicies.map((p) => [p.categoryId, { minMarginPercent: Number(p.minMarginPercent), targetMarginPercent: Number(p.targetMarginPercent) }]));

  const byCategory = new Map<string, { categoryName: string; products: Array<{ effectiveMarginPct: number | null; realizedMarginPct: number | null; units90d: number }> }>();
  for (const balance of balances) {
    const categoryId = balance.product.categoryId;
    const key = `${input.branchId}:${balance.productId}`;
    const effective = effectiveByKey.get(key);
    const effectivePrice = effective?.effectivePrice === null || effective?.effectivePrice === undefined ? null : Number(effective.effectivePrice);
    const effectiveCost = effective?.effectiveCost === null || effective?.effectiveCost === undefined ? null : Number(effective.effectiveCost);
    const effectiveMarginPct = effectivePrice !== null && effectiveCost !== null && effectivePrice > 0 ? ((effectivePrice - effectiveCost) / effectivePrice) * 100 : null;
    const realized = realizedByKey.get(key) ?? null;

    if (!byCategory.has(categoryId)) byCategory.set(categoryId, { categoryName: balance.product.category.name, products: [] });
    byCategory.get(categoryId)!.products.push({
      effectiveMarginPct,
      realizedMarginPct: realizedMarginUsable(realized) ? realized.marginPct : null,
      units90d: units90dByProduct.get(balance.productId) ?? 0,
    });
  }

  const rows = [...byCategory.entries()].map(([categoryId, data]) => {
    const policy = policyByCategory.get(categoryId);
    return buildCategoryCalibration({
      categoryId,
      categoryName: data.categoryName,
      currentMinMarginPercent: policy?.minMarginPercent ?? branchDefaults.minMarginPercent,
      currentTargetMarginPercent: policy?.targetMarginPercent ?? branchDefaults.targetMarginPercent,
      products: data.products,
    });
  });

  rows.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  return { categories: rows };
}
