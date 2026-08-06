import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { riskScoreFor } from "@/modules/brain/scoring";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";

function n(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

export async function detectPurchasingDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];
  const staleDate = new Date(ctx.now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [staleOrders, criticalBalances] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: {
        status: { in: ["DRAFT", "APPROVED"] },
        createdAt: { lt: staleDate },
        branch: { isActive: true },
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      },
      include: { branch: { select: { id: true, code: true, name: true } }, lines: true },
      take: 100,
      orderBy: { createdAt: "asc" },
    }),
    prisma.inventoryBalance.findMany({
      where: {
        quantityOnHand: { lte: 0 },
        product: { is: { isActive: true } },
        branch: { is: { isActive: true } },
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true, standardSalePrice: true } },
      },
      take: 100,
      orderBy: { updatedAt: "asc" },
    }),
  ]);

  for (const order of staleOrders) {
    decisions.push({
      category: "PURCHASING",
      severity: order.status === "APPROVED" ? "HIGH" : "MEDIUM",
      title: `Orden de compra sin cierre: ${order.orderNumber}`,
      description: `${order.branch.code} tiene una orden ${order.status} creada hace mas de 7 dias.`,
      recommendation: "Revisar proveedor, recepcion pendiente y necesidad real antes de aprobar o cancelar.",
      branchId: order.branchId,
      confidenceScore: 82,
      impactAmount: n(order.total),
      riskScore: riskScoreFor(order.status === "APPROVED" ? "HIGH" : "MEDIUM", 82),
      proposedActionType: "REVIEW_PURCHASE_ORDER",
      proposedActionJson: { purchaseOrderId: order.id },
      evidenceJson: { orderNumber: order.orderNumber, status: order.status, total: n(order.total), lines: order.lines.length },
      sourceJson: { detector: "purchasing-detector", purchaseOrderId: order.id },
      fingerprintParts: ["purchasing", "stale-purchase-order", order.id],
    });
  }

  for (const balance of criticalBalances) {
    const wac = n(balance.weightedAverageCost);
    // C: Use REVIEW_PURCHASE_NEED instead of CREATE_PURCHASE_ORDER_DRAFT.
    // Auto-creating purchase orders without validated reorder policy, supplier or cost is dangerous.
    decisions.push({
      category: "PURCHASING",
      severity: n(balance.quantityOnHand) < 0 ? "CRITICAL" : "HIGH",
      title: `Compra sugerida por stock critico: ${balance.product.sku}`,
      description: `${balance.branch.code} tiene ${n(balance.quantityOnHand)} unidades de ${balance.product.name}.`,
      recommendation: "Revisar politica de reorden, costo y proveedor antes de crear orden. Transferir desde otra sucursal si hay excedente.",
      branchId: balance.branchId,
      productId: balance.productId,
      confidenceScore: 86,
      impactAmount: Math.max(n(balance.product.standardSalePrice), wac),
      riskScore: riskScoreFor(n(balance.quantityOnHand) < 0 ? "CRITICAL" : "HIGH", 86),
      proposedActionType: "REVIEW_PURCHASE_NEED",
      proposedActionJson: {
        branchId: balance.branchId,
        suggestedLines: [{ productId: balance.productId, unitCost: wac }],
      },
      evidenceJson: { quantityOnHand: n(balance.quantityOnHand), weightedAverageCost: wac },
      sourceJson: { detector: "purchasing-detector", balanceId: balance.id },
      fingerprintParts: ["purchasing", "critical-stock-purchase", balance.branchId, balance.productId],
    });
  }

  return decisions;
}
