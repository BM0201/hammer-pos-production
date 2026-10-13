/**
 * Parte C (prompt-completo-pendientes-2026-10.md) — "Al terminar": consulta
 * de SOLO LECTURA para mostrarle al dueño el punto de partida antes de que
 * las políticas configurables (Fase 3) empiecen a cambiar comportamiento.
 *
 * 1. Cuántas filas tiene hoy la Bandeja por motivo.
 * 2. El margen realizado mediano por categoría en 90 días, por sucursal.
 *
 * No escribe nada. Ejecutar con: npx tsx scripts/diagnose-pricing-tray-baseline.ts
 */
import { prisma } from "@/lib/prisma";
import { computeRealizedMarginBatch, realizedMarginUsable } from "@/modules/pricing/tray-context-service";

const APPLICABLE_TYPES = ["REVIEW_PRICE_BELOW_COST", "REVIEW_PRICE_MARGIN_POLICY", "REVIEW_BRANCH_COST_PRICE", "COST_CHANGED_PRICE_STALE", "REVIEW_FUSION_UNSELLABLE", "REVIEW_PRODUCT_NO_COST"] as const;

function reasonForType(type: string | null): string {
  if (type === "REVIEW_PRICE_BELOW_COST" || type === "REVIEW_BRANCH_COST_PRICE" || type === "REVIEW_FUSION_UNSELLABLE") return "BELOW_COST";
  if (type === "REVIEW_PRICE_MARGIN_POLICY") return "MARGIN_POLICY";
  if (type === "REVIEW_PRODUCT_NO_COST") return "NO_COST";
  return "COST_STALE";
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  // 1. Filas de la Bandeja por motivo, hoy.
  const openDecisions = await prisma.brainDecision.findMany({
    where: { category: "PRICING", status: "OPEN", proposedActionType: { in: [...APPLICABLE_TYPES] } },
    select: { proposedActionType: true, branchId: true, productId: true },
  });
  const byReason: Record<string, number> = { BELOW_COST: 0, MARGIN_POLICY: 0, COST_STALE: 0, NO_COST: 0 };
  for (const d of openDecisions) byReason[reasonForType(d.proposedActionType)] += 1;

  // 2. Margen realizado mediano por categoría en 90 días, por sucursal.
  const pairs = [...new Set(openDecisions.filter((d) => d.branchId && d.productId).map((d) => `${d.branchId}:${d.productId}`))]
    .map((key) => { const [branchId, productId] = key.split(":"); return { branchId, productId }; });

  const products = await prisma.product.findMany({ where: { id: { in: pairs.map((p) => p.productId) } }, select: { id: true, categoryId: true, category: { select: { name: true } } } });
  const categoryByProduct = new Map(products.map((p) => [p.id, { categoryId: p.categoryId, categoryName: p.category.name }]));

  const branches = await prisma.branch.findMany({ where: { id: { in: [...new Set(pairs.map((p) => p.branchId))] } }, select: { id: true, name: true } });
  const branchById = new Map(branches.map((b) => [b.id, b.name]));

  const realizedByKey = await computeRealizedMarginBatch(prisma, pairs);

  const byBranchCategory = new Map<string, { branchName: string; categoryName: string; margins: number[] }>();
  for (const pair of pairs) {
    const key = `${pair.branchId}:${pair.productId}`;
    const realized = realizedByKey.get(key) ?? null;
    if (!realizedMarginUsable(realized)) continue;
    const cat = categoryByProduct.get(pair.productId);
    if (!cat) continue;
    const groupKey = `${pair.branchId}::${cat.categoryId}`;
    if (!byBranchCategory.has(groupKey)) byBranchCategory.set(groupKey, { branchName: branchById.get(pair.branchId) ?? pair.branchId, categoryName: cat.categoryName, margins: [] });
    byBranchCategory.get(groupKey)!.margins.push(realized.marginPct);
  }

  const medianByBranchCategory = [...byBranchCategory.values()]
    .map((g) => ({ branchName: g.branchName, categoryName: g.categoryName, productsWithData: g.margins.length, medianRealizedMarginPct: median([...g.margins].sort((a, b) => a - b)) }))
    .sort((a, b) => a.branchName.localeCompare(b.branchName) || a.categoryName.localeCompare(b.categoryName));

  console.log(JSON.stringify({
    trayRowsByReason: byReason,
    trayRowsTotal: openDecisions.length,
    medianRealizedMarginByBranchAndCategory: medianByBranchCategory,
  }, null, 2));
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
