import { BrainDecisionCategory, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ventas que cuentan: cobradas (ni borradores, ni pendientes de pago, ni anuladas). */
const NOT_SOLD = ["DRAFT", "PENDING_PAYMENT", "CANCELLED"] as const;

type SaleLine = { quantity: unknown; lineSubtotal: unknown; costSnapshot: unknown };

/** Ganancia (o, si falta algún costo, ingreso) y unidades de un período. Puro, con prueba. */
export function summarizeLines(lines: SaleLine[]) {
  const units = lines.reduce((sum, l) => sum + n(l.quantity), 0);
  const revenue = lines.reduce((sum, l) => sum + n(l.lineSubtotal), 0);
  const hasAllCosts = lines.every((l) => l.costSnapshot !== null && l.costSnapshot !== undefined);
  const profit = hasAllCosts ? lines.reduce((sum, l) => sum + n(l.lineSubtotal) - n(l.costSnapshot) * n(l.quantity), 0) : null;
  return { units, revenue, profit };
}

const money = (v: number) => `C$ ${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * ¿El cambio de precio dejó más plata? Compara los mismos N días antes y
 * después del cambio (7 a 14, lo que ya haya pasado): ganancia si todos los
 * renglones traen costo, si no, ingreso. Igual o más = salió bien.
 */
export function judgePriceChange(before: ReturnType<typeof summarizeLines>, after: ReturnType<typeof summarizeLines>, days: number) {
  if (before.units === 0 && after.units === 0) {
    return { successScore: null, actualImpact: null, notes: `Sin ventas ${days} días antes ni después del cambio de precio: todavía no se puede saber.` };
  }
  const useProfit = before.profit !== null && after.profit !== null;
  const b = useProfit ? (before.profit as number) : before.revenue;
  const a = useProfit ? (after.profit as number) : after.revenue;
  const what = useProfit ? "ganancia" : "venta";
  const diff = Math.round((a - b) * 100) / 100;
  return {
    successScore: a >= b ? 75 : 30,
    actualImpact: diff,
    notes: `${days} días antes del cambio: ${money(b)} de ${what} (${before.units} u). ${days} días después: ${money(a)} (${after.units} u). ${a >= b ? "Salió bien" : "Dejó menos"}.`,
  };
}

async function measurePriceChange(db: Db, input: { productId: string; branchId: string; changedAt: Date; now: Date }) {
  const days = Math.max(7, Math.min(14, Math.floor((input.now.getTime() - input.changedAt.getTime()) / DAY_MS)));
  const span = days * DAY_MS;
  const linesBetween = (from: Date, to: Date) => db.saleOrderLine.findMany({
    where: { productId: input.productId, saleOrder: { branchId: input.branchId, status: { notIn: [...NOT_SOLD] }, createdAt: { gte: from, lt: to } } },
    select: { quantity: true, lineSubtotal: true, costSnapshot: true },
  });
  const [before, after] = await Promise.all([
    linesBetween(new Date(input.changedAt.getTime() - span), input.changedAt),
    linesBetween(input.changedAt, new Date(input.changedAt.getTime() + span)),
  ]);
  return judgePriceChange(summarizeLines(before), summarizeLines(after), days);
}

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
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const decisions = await db.brainDecision.findMany({
    where: {
      outcomes: { none: {} },
      resolvedAt: { lte: weekAgo },
      OR: [
        {
          status: "EXECUTED",
          category: { in: [BrainDecisionCategory.REORDER, BrainDecisionCategory.PRICING, BrainDecisionCategory.DISPATCH, BrainDecisionCategory.CASH] },
        },
        // Precio aplicado desde la Bandeja de precios (tray-service.ts): queda
        // RESOLVED con el producto en executedEntityId. Solo los últimos 90 días.
        { status: "RESOLVED", category: BrainDecisionCategory.PRICING, executedEntityType: "Product", resolvedAt: { gte: new Date(now.getTime() - 90 * DAY_MS) } },
      ],
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
    let notes = "Evaluacion inicial automatica con datos disponibles.";

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
    } else if (decision.category === BrainDecisionCategory.PRICING && decision.status === "RESOLVED" && decision.branchId && decision.resolvedAt) {
      const productId = decision.executedEntityId ?? decision.productId;
      if (productId) {
        const measured = await measurePriceChange(db, { productId, branchId: decision.branchId, changedAt: decision.resolvedAt, now });
        actualImpact = measured.actualImpact;
        successScore = measured.successScore;
        notes = measured.notes;
      }
    }

    await db.brainDecisionOutcome.create({
      data: {
        decisionId: decision.id,
        measuredAt: now,
        outcomeType: "INITIAL_REVIEW",
        expectedImpact,
        actualImpact,
        successScore,
        notes,
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
