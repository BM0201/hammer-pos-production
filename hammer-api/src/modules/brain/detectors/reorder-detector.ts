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
    // H: filter inactive products and inactive branches
    prisma.inventoryBalance.findMany({
      where: {
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
        product: { is: { isActive: true } },
      },
      include: {
        branch: { select: { id: true, code: true, name: true, isActive: true } },
        product: { select: { id: true, sku: true, name: true } },
      },
      take: 2000,
    }),
  ]);

  const balancesByKey = new Map(balances.map((b) => [`${b.branchId}:${b.productId}`, b]));
  const balancesByProduct = new Map<string, typeof balances>();
  for (const balance of balances) {
    if (!balancesByProduct.has(balance.productId)) balancesByProduct.set(balance.productId, []);
    balancesByProduct.get(balance.productId)!.push(balance);
  }

  // I: build policy map so transfer candidates can check source branch safety floor
  const policiesByKey = new Map(policies.map((p) => [`${p.branchId}:${p.productId}`, p]));

  for (const alert of alerts) {
    // F: impactAmount should use WAC or sale price, not currentQuantity
    const alertBalance = balancesByKey.get(`${alert.branchId}:${alert.productId}`);
    const wac = n(alertBalance?.weightedAverageCost);
    decisions.push({
      category: "REORDER",
      severity: n(alert.currentQuantity) <= n(alert.reorderPoint) / 2 ? "HIGH" : "MEDIUM",
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
      impactAmount: n(alert.suggestedQuantity) * Math.max(wac, 0),
      riskScore: riskScoreFor(n(alert.currentQuantity) <= n(alert.reorderPoint) / 2 ? "HIGH" : "MEDIUM", 0.88),
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

  for (const policy of policies) {
    const balance = balancesByKey.get(`${policy.branchId}:${policy.productId}`);
    const current = n(balance?.quantityOnHand);
    const reorderPoint = n(policy.reorderPoint);
    if (current > reorderPoint) continue;

    const recentSales = await prisma.saleOrderLine.findMany({
      where: {
        productId: policy.productId,
        // J: use dateTo so DEEP_SCAN respects the specified end date
        createdAt: { gte: ctx.since, lte: ctx.dateTo },
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

    // I: only suggest transfer from branches that have enough stock above their own safety floor
    const candidates = (balancesByProduct.get(policy.productId) ?? [])
      .filter((b) => {
        if (b.branchId === policy.branchId || !b.branch.isActive) return false;
        const sourcePolicy = policiesByKey.get(`${b.branchId}:${policy.productId}`);
        const sourceFloor = sourcePolicy
          ? Math.max(n(sourcePolicy.reorderPoint), n(sourcePolicy.minQuantity))
          : 0;
        // Source must have enough that after fulfilling destination target they stay above their floor
        return n(b.quantityOnHand) - n(policy.targetQuantity) > sourceFloor;
      })
      .sort((a, b) => n(b.quantityOnHand) - n(a.quantityOnHand));

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
