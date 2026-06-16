import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listReorderAlerts } from "@/modules/reorder/service";
import { riskScoreFor } from "@/modules/brain/scoring";
import { forecastDemand } from "@/modules/brain/prediction/demand-forecast";
import { simulateReorder } from "@/modules/brain/prediction/reorder-simulation";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";

function n(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

export async function detectReorderDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];

  const [alerts, policies, balances] = await Promise.all([
    listReorderAlerts({ branchId: ctx.branchId, status: "OPEN", limit: 150 }),
    prisma.stockReorderPolicy.findMany({
      where: { isActive: true, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true } },
      },
      take: 500,
    }),
    prisma.inventoryBalance.findMany({
      where: ctx.branchId ? { branchId: ctx.branchId } : {},
      include: {
        branch: { select: { id: true, code: true, name: true, isActive: true } },
        product: { select: { id: true, sku: true, name: true } },
      },
      take: 2000,
    }),
  ]);

  for (const alert of alerts) {
    const severity = n(alert.currentQuantity) <= n(alert.reorderPoint) / 2 ? "HIGH" : "MEDIUM";
    decisions.push({
      category: "REORDER",
      severity,
      title: `Reposicion sugerida: ${alert.product.sku} - ${alert.product.name}`,
      description: alert.reason,
      recommendation: alert.alertType === "TRANSFER"
        ? "Aprobar una transferencia desde la sucursal con excedente antes de comprar."
        : alert.alertType === "BOTH"
          ? "Crear transferencia parcial y completar con compra externa."
          : "Preparar compra externa segun proveedor preferido y cantidad sugerida.",
      branchId: alert.branchId,
      productId: alert.productId,
      confidenceScore: 0.88,
      impactAmount: n(alert.suggestedQuantity) * n(alert.currentQuantity),
      riskScore: riskScoreFor(severity, 0.88),
      proposedActionType: alert.alertType === "TRANSFER" ? "CONVERT_REORDER_ALERT_TO_TRANSFER" : "CONVERT_REORDER_ALERT_TO_PURCHASE",
      proposedActionJson: { reorderAlertId: alert.id, alertType: alert.alertType, suggestedQuantity: n(alert.suggestedQuantity) },
      evidenceJson: {
        currentQuantity: n(alert.currentQuantity),
        reorderPoint: n(alert.reorderPoint),
        targetQuantity: n(alert.targetQuantity),
        suggestedQuantity: n(alert.suggestedQuantity),
        sourceBranchId: alert.nearestSourceBranchId,
      },
      sourceJson: { detector: "reorder-detector", reorderAlertId: alert.id },
      fingerprintParts: ["reorder", "open-alert", alert.id],
    });
  }

  const balancesByKey = new Map(balances.map((b) => [`${b.branchId}:${b.productId}`, b]));
  const balancesByProduct = new Map<string, typeof balances>();
  for (const balance of balances) {
    if (!balancesByProduct.has(balance.productId)) balancesByProduct.set(balance.productId, []);
    balancesByProduct.get(balance.productId)!.push(balance);
  }

  for (const policy of policies) {
    const balance = balancesByKey.get(`${policy.branchId}:${policy.productId}`);
    const current = n(balance?.quantityOnHand);
    const reorderPoint = n(policy.reorderPoint);
    if (current > reorderPoint) continue;

    const candidates = (balancesByProduct.get(policy.productId) ?? [])
      .filter((b) => b.branchId !== policy.branchId && b.branch.isActive && n(b.quantityOnHand) > n(policy.targetQuantity))
      .sort((a, b) => n(b.quantityOnHand) - n(a.quantityOnHand));
    const recentSales = await prisma.saleOrderLine.findMany({
      where: {
        productId: policy.productId,
        createdAt: { gte: ctx.since, lte: ctx.now },
        saleOrder: { branchId: policy.branchId },
      },
      select: { createdAt: true, quantity: true },
      take: 500,
    });
    const forecast = forecastDemand({
      history: recentSales.map((line) => ({ date: line.createdAt, quantity: n(line.quantity) })),
      quantityAvailable: current,
      now: ctx.now,
      windowDays: ctx.days,
    });
    const simulation = simulateReorder({
      quantityAvailable: current,
      dailyDemandAvg: forecast.dailyDemandAvg,
      targetQuantity: n(policy.targetQuantity),
      safetyStock: n(policy.safetyStock),
      unitCost: n(balance?.weightedAverageCost),
    });

    decisions.push({
      category: "REORDER",
      severity: current <= n(policy.minQuantity) ? "CRITICAL" : "HIGH",
      title: `Bajo punto de reorden: ${policy.product.sku}`,
      description: `${policy.branch.code} tiene ${current} unidades; punto de reorden ${reorderPoint}.`,
      recommendation: candidates[0]
        ? `Sugerir transferencia desde ${candidates[0].branch.code} o compra si no alcanza el excedente.`
        : "Sugerir compra externa para llevar inventario a la cantidad objetivo.",
      branchId: policy.branchId,
      productId: policy.productId,
      confidenceScore: 0.86,
      riskScore: riskScoreFor(current <= n(policy.minQuantity) ? "CRITICAL" : "HIGH", 0.86),
      proposedActionType: candidates[0] ? "SUGGEST_TRANSFER_OR_PURCHASE" : "SUGGEST_PURCHASE",
      proposedActionJson: {
        policyId: policy.id,
        suggestedQuantity: simulation.suggestedQuantity,
        sourceBranchId: candidates[0]?.branchId ?? null,
      },
      evidenceJson: {
        currentQuantity: current,
        reorderPoint,
        targetQuantity: n(policy.targetQuantity),
        demandForecast: {
          dailyDemandAvg: forecast.dailyDemandAvg,
          trend: forecast.trend,
          coverageDays: forecast.coverageDays,
          stockoutDate: forecast.stockoutDate,
          confidence: forecast.confidence,
        },
        reorderSimulation: simulation,
        sourceBranches: candidates.slice(0, 3).map((b) => ({ branch: b.branch.code, quantityOnHand: n(b.quantityOnHand) })),
      },
      sourceJson: { detector: "reorder-detector", policyId: policy.id },
      fingerprintParts: ["reorder", "policy-below-point", policy.branchId, policy.productId],
    });
  }

  return decisions;
}
