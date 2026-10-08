import { BrainDecisionCategory, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

function n(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

/**
 * Fase 1.7 — `outcomes: { none: {} }` solo tiene sentido ahora que
 * runBrainDecision/executeBrainDecision ya NO crean un outcome al
 * ejecutar (antes creaban uno con successScore:50 de inmediato, así que
 * esta condición nunca volvía a ser cierta para nada ejecutado por el
 * camino normal — esta función quedaba muerta para su propósito real).
 */
export async function evaluateExecutedDecisions(input: { now?: Date; limit?: number } = {}, db: Db = prisma) {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const decisions = await db.brainDecision.findMany({
    where: {
      status: "EXECUTED",
      category: { in: [BrainDecisionCategory.REORDER, BrainDecisionCategory.PRICING, BrainDecisionCategory.DISPATCH, BrainDecisionCategory.CASH] },
      outcomes: { none: {} },
      resolvedAt: { lte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
    },
    include: { product: true },
    take: input.limit ?? 50,
  });

  let created = 0;
  for (const decision of decisions) {
    const expectedImpact = n(decision.impactAmount);
    let actualImpact: number | null = null;
    // Fase 1.7 — sin medida real, null (no un 50 inventado). Hoy solo
    // REORDER tiene una forma de medir impacto real (unidades vendidas
    // después); el resto queda sin successScore hasta que exista una.
    let successScore: number | null = null;

    if (decision.category === BrainDecisionCategory.REORDER && decision.productId) {
      const units = await db.saleOrderLine.aggregate({
        where: {
          productId: decision.productId,
          saleOrder: {
            branchId: decision.branchId ?? undefined,
            createdAt: { gte: decision.resolvedAt ?? since, lte: now },
          },
        },
        _sum: { quantity: true },
      });
      actualImpact = n(units._sum.quantity);
      successScore = actualImpact > 0 ? Math.min(100, 55 + actualImpact * 3) : 35;
    }

    await db.brainDecisionOutcome.create({
      data: {
        decisionId: decision.id,
        measuredAt: now,
        outcomeType: "INITIAL_REVIEW",
        expectedImpact,
        actualImpact,
        successScore,
        notes: "Evaluacion inicial automatica con datos disponibles.",
        metadataJson: {
          evaluator: "brain-outcomes",
          category: decision.category,
          productId: decision.productId,
          branchId: decision.branchId,
        },
      },
    });
    created += 1;
  }

  return { scanned: decisions.length, created };
}
