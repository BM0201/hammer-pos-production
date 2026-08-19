import { prisma } from "@/lib/prisma";
import { getReplenishmentSignals } from "@/modules/inventory/replenishment-service";
import { riskScoreFor } from "@/modules/brain/scoring";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";

/**
 * Reposición v2 (Fase 1.6): el detector deja de leer ReorderAlert/StockReorderPolicy
 * (Motor 1, deprecado) y consume getReplenishmentSignals — el motor único. Mismo
 * contrato BrainDecisionDraft, para no tocar el resto del pipeline del Brain.
 *
 * proposedActionType = "REVIEW_REPLENISHMENT_SIGNAL": no ejecuta una conversión
 * directa (a diferencia del viejo CONVERT_REORDER_ALERT_TO_*) — decision-detail-drawer.tsx
 * redirige a /app/master/replenishment, donde el usuario agrega la señal al Plan
 * con el flujo completo (costos correctos, agrupación por proveedor real, etc.).
 */
export async function detectReorderDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];

  const branches = await prisma.branch.findMany({
    where: { isActive: true, ...(ctx.branchId ? { id: ctx.branchId } : {}) },
    select: { id: true, code: true, name: true },
    take: Math.min(20, ctx.limits.maxEntities),
  });

  for (const branch of branches) {
    if (decisions.length >= ctx.limits.maxIssues) break;

    const { signals } = await getReplenishmentSignals(branch.id);
    const relevant = signals.filter((s) => s.severity === "CRITICAL" || s.severity === "LOW");

    for (const signal of relevant) {
      if (decisions.length >= ctx.limits.maxIssues) break;

      const severity = signal.severity === "CRITICAL" ? "HIGH" : "MEDIUM";
      const primarySource = signal.sources[0];
      const recommendation = !primarySource
        ? "Revisar disponibilidad de proveedor o traslado antes de decidir."
        : primarySource.type === "TRANSFER"
          ? `Aprobar una transferencia desde ${primarySource.branchName ?? "la sucursal con excedente"} antes de comprar.`
          : primarySource.type === "PRODUCTION"
            ? "Evaluar producción interna antes de comprar (receta activa disponible)."
            : "Preparar compra externa según proveedor preferido y cantidad sugerida.";

      decisions.push({
        category: "REORDER",
        severity,
        title: `Reposición sugerida: ${signal.sku} - ${signal.name}`,
        description: signal.message,
        recommendation,
        branchId: branch.id,
        productId: signal.productId,
        confidenceScore: 0.88,
        impactAmount: signal.estimatedCost,
        riskScore: riskScoreFor(severity, 0.88),
        proposedActionType: "REVIEW_REPLENISHMENT_SIGNAL",
        proposedActionJson: { productId: signal.productId, branchId: branch.id, netNeed: signal.netNeed, sources: signal.sources },
        evidenceJson: {
          stockOnHand: signal.stockOnHand,
          reorderPoint: signal.reorderPoint,
          targetQuantity: signal.targetQuantity,
          netNeed: signal.netNeed,
          inboundQuantity: signal.inboundQuantity,
          mode: signal.mode,
          abcClass: signal.abcClass,
          xyzClass: signal.xyzClass,
          coverageDaysRemaining: signal.coverageDaysRemaining,
        },
        sourceJson: { detector: "reorder-detector", engine: "replenishment-v2" },
        fingerprintParts: ["replenishment", "signal", branch.id, signal.productId],
      });
    }
  }

  return decisions;
}
