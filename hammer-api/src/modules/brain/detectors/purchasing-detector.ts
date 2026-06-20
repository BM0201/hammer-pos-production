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
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      },
      include: { branch: { select: { id: true, code: true, name: true } }, lines: true },
      take: 100,
      orderBy: { createdAt: "asc" },
    }),
    prisma.inventoryBalance.findMany({
      where: { quantityOnHand: { lte: 0 }, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) },
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
    decisions.push({
      category: "PURCHASING",
      severity: n(balance.quantityOnHand) < 0 ? "CRITICAL" : "HIGH",
      title: `Compra sugerida por stock critico: ${balance.product.sku}`,
      description: `${balance.branch.code} tiene ${n(balance.quantityOnHand)} unidades de ${balance.product.name}.`,
      recommendation: "Crear pedido de compra en borrador o transferir desde otra sucursal si hay excedente.",
      branchId: balance.branchId,
      productId: balance.productId,
      confidenceScore: 86,
      impactAmount: Math.max(n(balance.product.standardSalePrice), n(balance.weightedAverageCost)),
      riskScore: riskScoreFor(n(balance.quantityOnHand) < 0 ? "CRITICAL" : "HIGH", 86),
      proposedActionType: "CREATE_PURCHASE_ORDER_DRAFT",
      proposedActionJson: {
        branchId: balance.branchId,
        lines: [{ productId: balance.productId, quantity: 10, unitCost: n(balance.weightedAverageCost) }],
      },
      evidenceJson: { quantityOnHand: n(balance.quantityOnHand), weightedAverageCost: n(balance.weightedAverageCost) },
      sourceJson: { detector: "purchasing-detector", balanceId: balance.id },
      fingerprintParts: ["purchasing", "critical-stock-purchase", balance.branchId, balance.productId],
    });
  }

  return decisions;
}
