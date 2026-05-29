import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { riskScoreFor } from "@/modules/brain/scoring";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";

function n(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

export async function detectSalesDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];
  const midPoint = new Date(ctx.now.getTime() - Math.floor(ctx.days / 2) * 24 * 60 * 60 * 1000);

  const [orders, lines] = await Promise.all([
    prisma.saleOrder.findMany({
      where: { createdAt: { gte: ctx.since }, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) },
      include: { branch: { select: { id: true, code: true, name: true } } },
      take: 2000,
      orderBy: { createdAt: "desc" },
    }),
    prisma.saleOrderLine.findMany({
      where: { saleOrder: { createdAt: { gte: ctx.since }, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) } },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        saleOrder: { select: { createdAt: true, branchId: true } },
      },
      take: 3000,
    }),
  ]);

  const branchTotals = new Map<string, { branchId: string; code: string; name: string; total: number; count: number }>();
  for (const order of orders) {
    const current = branchTotals.get(order.branchId) ?? {
      branchId: order.branchId,
      code: order.branch.code,
      name: order.branch.name,
      total: 0,
      count: 0,
    };
    current.total += n(order.grandTotal);
    current.count++;
    branchTotals.set(order.branchId, current);
  }

  const branchRows = [...branchTotals.values()].filter((row) => row.count >= 3);
  const average = branchRows.length > 0 ? branchRows.reduce((sum, row) => sum + row.total, 0) / branchRows.length : 0;
  for (const row of branchRows) {
    if (average > 0 && row.total < average * 0.55) {
      decisions.push({
        category: "SALES",
        severity: "MEDIUM",
        title: `Sucursal bajo promedio de ventas: ${row.code}`,
        description: `${row.name} vendio C$${row.total.toFixed(2)} frente a un promedio de C$${average.toFixed(2)}.`,
        recommendation: "Revisar stock, horarios pico, precios y demanda local antes de ajustar metas.",
        branchId: row.branchId,
        confidenceScore: 0.76,
        impactAmount: average - row.total,
        riskScore: riskScoreFor("MEDIUM", 0.76),
        proposedActionType: "REVIEW_BRANCH_SALES_PERFORMANCE",
        evidenceJson: { branchTotal: row.total, averageBranchTotal: average, orders: row.count },
        sourceJson: { detector: "sales-detector" },
        fingerprintParts: ["sales", "branch-below-average", row.branchId],
      });
    }
  }

  const productTrend = new Map<string, { productId: string; sku: string; name: string; early: number; late: number }>();
  for (const line of lines) {
    const row = productTrend.get(line.productId) ?? {
      productId: line.productId,
      sku: line.product.sku,
      name: line.product.name,
      early: 0,
      late: 0,
    };
    if (line.saleOrder.createdAt >= midPoint) row.late += n(line.quantity);
    else row.early += n(line.quantity);
    productTrend.set(line.productId, row);
  }

  for (const row of productTrend.values()) {
    if (row.early + row.late < 10) continue;
    if (row.late >= row.early * 2 && row.late >= 8) {
      decisions.push({
        category: "SALES",
        severity: "INFO",
        title: `Tendencia creciente: ${row.sku}`,
        description: `${row.name} duplico ritmo reciente (${row.early} vs ${row.late} unidades).`,
        recommendation: "Validar inventario y punto de reorden para no perder ventas por quiebre.",
        productId: row.productId,
        confidenceScore: 0.72,
        riskScore: riskScoreFor("INFO", 0.72),
        proposedActionType: "REVIEW_PRODUCT_DEMAND_TREND",
        evidenceJson: { previousHalfUnits: row.early, recentHalfUnits: row.late },
        sourceJson: { detector: "sales-detector" },
        fingerprintParts: ["sales", "trend-up", row.productId, ctx.branchId ?? "all"],
      });
    } else if (row.early >= row.late * 2 && row.early >= 8) {
      decisions.push({
        category: "SALES",
        severity: "LOW",
        title: `Tendencia decreciente: ${row.sku}`,
        description: `${row.name} bajo de ${row.early} a ${row.late} unidades entre mitades del periodo.`,
        recommendation: "Revisar precio, disponibilidad y rotacion antes de reponer agresivamente.",
        productId: row.productId,
        confidenceScore: 0.7,
        riskScore: riskScoreFor("LOW", 0.7),
        proposedActionType: "REVIEW_PRODUCT_DEMAND_TREND",
        evidenceJson: { previousHalfUnits: row.early, recentHalfUnits: row.late },
        sourceJson: { detector: "sales-detector" },
        fingerprintParts: ["sales", "trend-down", row.productId, ctx.branchId ?? "all"],
      });
    }
  }

  return decisions;
}
