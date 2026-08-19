import { CashSessionStatus, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { OPERATIONAL_TIMEZONE, businessDateFromInput, businessDateFromNow, operationalWindow } from "@/modules/operations/business-date";
import {
  calculateOperationalSummaryTx,
  closeOrphanedCashSessionsForDayTx,
  refreshOperationalDaySummaryTx,
  buildChecklist,
} from "@/modules/operations/day-summary";
import { getCashToleranceConfig, resolveCashToleranceForBranch } from "@/modules/operations/cash-tolerance-config";

const TIMEZONE = OPERATIONAL_TIMEZONE;

function decimal(value: number) {
  return new Prisma.Decimal(Number.isFinite(value) ? value : 0);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Saca un día de ACTIVE sin finalizarlo — nunca lo confirma, nunca lo borra.
 * Idempotente vía el claim con updateMany condicionado al lifecycle previo.
 */
export async function sweepDayToAwaitingReviewTx(
  tx: Prisma.TransactionClient,
  day: { id: string; branchId: string; businessDate: Date },
  opts: { bySystem: boolean; actorUserId?: string; note?: string } = { bySystem: true },
): Promise<void> {
  const claimed = await tx.operationalDay.updateMany({
    where: { id: day.id, lifecycle: "ACTIVE" },
    data: {
      lifecycle: "AWAITING_REVIEW",
      sweptAt: new Date(),
      sweptBySystem: opts.bySystem,
      sweptByUserId: opts.bySystem ? null : opts.actorUserId ?? null,
    },
  });
  if (claimed.count !== 1) return;

  const orphanCashSessionsClosed = await closeOrphanedCashSessionsForDayTx(tx, day.id);

  // Recalcular una última vez ANTES de congelar el día — para que la cola de
  // pendientes ya muestre el total real sin esperar a que Master lo confirme.
  await refreshOperationalDaySummaryTx(tx, day.id);

  await tx.auditLog.create({
    data: {
      actorUserId: opts.bySystem ? null : opts.actorUserId ?? null,
      branchId: day.branchId,
      module: "operations",
      action: "OPERATIONAL_DAY_SWEPT_TO_AWAITING_REVIEW",
      entityType: "OperationalDay",
      entityId: day.id,
      metadataJson: toJsonValue({
        businessDate: day.businessDate,
        orphanCashSessionsClosed,
        bySystem: opts.bySystem,
        note: opts.note ?? null,
        reason: "El día dejó de ser el activo — nunca se pierde ni bloquea, espera confirmación en la cola de pendientes.",
      }),
    },
  });
}

/** Barrido periódico (cron) de TODOS los días ACTIVE de fecha pasada, en cualquier sucursal. */
export async function sweepStaleOperationalDaysToAwaitingReview(
  input: { now?: Date; dryRun?: boolean } = {},
): Promise<{ scanned: number; swept: number; errors: Array<{ branchId: string; message: string }> }> {
  const today = businessDateFromNow(input.now);
  const staleActiveDays = await prisma.operationalDay.findMany({
    where: { lifecycle: "ACTIVE", businessDate: { lt: today } },
    select: { id: true, branchId: true, businessDate: true },
    take: 200,
  });

  if (input.dryRun) {
    return { scanned: staleActiveDays.length, swept: 0, errors: [] };
  }

  let swept = 0;
  const errors: Array<{ branchId: string; message: string }> = [];
  for (const day of staleActiveDays) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${day.id} FOR UPDATE`;
        await sweepDayToAwaitingReviewTx(tx, day, { bySystem: true });
      });
      swept += 1;
    } catch (err) {
      errors.push({ branchId: day.branchId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { scanned: staleActiveDays.length, swept, errors };
}

/**
 * Botón "Cerrar jornada" de sucursal — barre el día de ACTIVE a
 * AWAITING_REVIEW manualmente (antes de que pase su fecha). NO confirma nada:
 * el día queda esperando en la cola, igual que si el barrido automático lo
 * hubiera alcanzado. confirmOperationalDay puede recibir un día ya barrido
 * por acá, o barrerlo él mismo si seguía ACTIVE.
 */
export async function endShiftOperationalDay(input: { id: string; actorUserId: string; note?: string | null }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${input.id} FOR UPDATE`;
    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });
    if (day.lifecycle !== "ACTIVE") throw new Error("OPERATIONAL_DAY_NOT_ACTIVE");
    await sweepDayToAwaitingReviewTx(tx, day, { bySystem: false, actorUserId: input.actorUserId, note: input.note ?? undefined });
    return tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });
  });
}

/**
 * Firma humana. Único camino a CONFIRMED. Rechaza a "SYSTEM" o cualquier id
 * que no resuelva a un User real — invariante verificada en runtime, no solo
 * por convención. Si el día sigue ACTIVE, confirmar implica barrerlo primero
 * (confirmar = cerrar la jornada, en un solo paso).
 */
export async function confirmOperationalDay(input: {
  id: string;
  actorUserId: string;
  note?: string | null;
}) {
  if (!input.actorUserId || input.actorUserId === "SYSTEM") {
    throw new Error("OPERATIONAL_DAY_CONFIRM_REQUIRES_HUMAN");
  }
  const actor = await prisma.user.findUnique({ where: { id: input.actorUserId }, select: { id: true } });
  if (!actor) throw new Error("OPERATIONAL_DAY_CONFIRM_REQUIRES_HUMAN");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${input.id} FOR UPDATE`;
    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });

    // Idempotente: ya confirmado, no re-ejecuta.
    if (day.reviewStatus === "CONFIRMED") return day;
    if (day.lifecycle === "CANCELLED") throw new Error("OPERATIONAL_DAY_CANCELLED");

    if (day.lifecycle === "ACTIVE") {
      await sweepDayToAwaitingReviewTx(tx, day, { bySystem: false, actorUserId: input.actorUserId });
    }

    const fresh = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });
    const summary = await calculateOperationalSummaryTx(tx, fresh);
    const toleranceConfig = await getCashToleranceConfig();
    const cashDifferenceToleranceAmount = resolveCashToleranceForBranch(toleranceConfig, fresh.branchId);
    const checklist = buildChecklist(summary, cashDifferenceToleranceAmount);

    // Los ítems en atención NUNCA impiden confirmar — solo exigen que quede
    // una nota escrita justificándolos.
    if (checklist.attention.length > 0 && !input.note?.trim()) {
      throw new Error("OPERATIONAL_DAY_CONFIRM_NOTE_REQUIRED");
    }

    const confirmed = await tx.operationalDay.update({
      where: { id: input.id },
      data: {
        reviewStatus: "CONFIRMED",
        reviewedByUserId: input.actorUserId,
        reviewedAt: new Date(),
        reviewNote: input.note?.trim() || null,
        checklistJson: toJsonValue(checklist),
        summaryJson: toJsonValue(summary),
        reviewSummaryJson: toJsonValue(summary),
        salesTotal: decimal(summary.salesTotal),
        paidOrdersTotal: decimal(summary.paidOrdersTotal),
        pendingPaymentTotal: decimal(summary.pendingPaymentTotal),
        expectedCashTotal: decimal(summary.expectedCashTotal),
        countedCashTotal: decimal(summary.countedCashTotal),
        cashDifferenceTotal: decimal(summary.cashDifferenceTotal),
        openCashSessionsCount: summary.openCashSessionsCount,
        autoClosedPendingReviewCount: summary.autoClosedPendingReviewCount,
        pendingDispatchCount: summary.pendingDispatchCount,
        criticalBrainDecisionCount: summary.criticalBrainDecisionCount,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: fresh.branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_CONFIRMED",
        entityType: "OperationalDay",
        entityId: fresh.id,
        metadataJson: toJsonValue({ note: input.note ?? null, checklist, summary }),
      },
    });

    return confirmed;
  });
}

/** AWAITING_REVIEW → ACTIVE. Master, nota obligatoria, solo si es el día de HOY. */
export async function reopenOperationalDay(input: { id: string; actorUserId: string; note: string }) {
  if (!input.note?.trim()) throw new Error("OPERATIONAL_DAY_REOPEN_NOTE_REQUIRED");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${input.id} FOR UPDATE`;
    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });

    if (day.lifecycle !== "AWAITING_REVIEW") throw new Error("OPERATIONAL_DAY_NOT_AWAITING_REVIEW");

    const today = businessDateFromNow();
    if (day.businessDate.getTime() !== today.getTime()) {
      throw new Error("OPERATIONAL_DAY_REOPEN_PAST_DATE");
    }

    const otherActive = await tx.operationalDay.findFirst({
      where: { branchId: day.branchId, id: { not: day.id }, lifecycle: "ACTIVE" },
      select: { id: true, businessDate: true },
    });
    if (otherActive) {
      const err = new Error("OPERATIONAL_DAY_REOPEN_BLOCKED_ACTIVE_DAY_EXISTS");
      (err as unknown as { activeDay: typeof otherActive }).activeDay = otherActive;
      throw err;
    }

    const reviewReverted = day.reviewStatus === "CONFIRMED";
    const reopened = await tx.operationalDay.update({
      where: { id: input.id },
      data: {
        lifecycle: "ACTIVE",
        sweptAt: null,
        sweptBySystem: false,
        sweptByUserId: null,
        notes: input.note,
        ...(reviewReverted ? { reviewStatus: "PENDING", reviewedByUserId: null, reviewedAt: null } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: day.branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_REOPENED",
        entityType: "OperationalDay",
        entityId: day.id,
        metadataJson: toJsonValue({
          note: input.note,
          reviewReverted,
          previousReviewedAt: day.reviewedAt,
          previousReviewSummaryJson: day.reviewSummaryJson ?? null,
        }),
      },
    });

    return reopened;
  });
}

/** CONFIRMED → PENDING. Reversión explícita de Master, nota obligatoria, auditada. */
export async function revertOperationalDayConfirmation(input: { id: string; actorUserId: string; note: string }) {
  if (!input.note?.trim()) throw new Error("OPERATIONAL_DAY_REVERT_NOTE_REQUIRED");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${input.id} FOR UPDATE`;
    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });
    if (day.reviewStatus !== "CONFIRMED") throw new Error("OPERATIONAL_DAY_NOT_CONFIRMED");

    const reverted = await tx.operationalDay.update({
      where: { id: input.id },
      data: { reviewStatus: "PENDING", reviewedByUserId: null, reviewedAt: null, reviewNote: input.note },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: day.branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_CONFIRMATION_REVERTED",
        entityType: "OperationalDay",
        entityId: day.id,
        metadataJson: toJsonValue({
          note: input.note,
          previousReviewedByUserId: day.reviewedByUserId,
          previousReviewedAt: day.reviewedAt,
        }),
      },
    });

    return reverted;
  });
}

/** Anulación explícita de Master — solo si el día no tuvo actividad real (o con override + nota). */
export async function cancelOperationalDay(input: { id: string; actorUserId: string; note: string; override?: boolean }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${input.id} FOR UPDATE`;
    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });

    // Un día confirmado NUNCA se cancela (ni con override): su firma es definitiva.
    if (day.reviewStatus === "CONFIRMED") throw new Error("OPERATIONAL_DAY_ALREADY_CONFIRMED");
    if (day.lifecycle === "CANCELLED") throw new Error("OPERATIONAL_DAY_ALREADY_CANCELLED");

    const { start, end } = operationalWindow(day.businessDate);
    const [
      postedPayments,
      executedReturns,
      executedCancellations,
      executedDispatches,
      executedTransports,
      cashMovementsCount,
      closedCashSessions,
    ] = await Promise.all([
      tx.payment.count({ where: { operationalDayId: day.id, status: PaymentStatus.POSTED } }),
      tx.saleReturn.count({ where: { operationalDayId: day.id, executedAt: { not: null } } }),
      tx.saleCancellation.count({ where: { operationalDayId: day.id, executedAt: { not: null } } }),
      tx.dispatchTicket.count({ where: { branchId: day.branchId, status: "DISPATCHED", createdAt: { gte: start, lt: end } } }),
      tx.transportService.count({ where: { branchId: day.branchId, status: "DELIVERED", createdAt: { gte: start, lt: end } } }),
      tx.cashMovement.count({ where: { cashSession: { operationalDayId: day.id } } }),
      tx.cashSession.count({ where: { operationalDayId: day.id, status: CashSessionStatus.CLOSED } }),
    ]);

    const cancelChecklist = {
      postedPayments,
      executedReturns,
      executedCancellations,
      executedDispatches,
      executedTransports,
      cashMovements: cashMovementsCount,
      closedCashSessions,
    };
    const hasRealActivity =
      postedPayments > 0 ||
      executedReturns > 0 ||
      executedCancellations > 0 ||
      executedDispatches > 0 ||
      executedTransports > 0 ||
      cashMovementsCount > 0;

    if (hasRealActivity && !input.override) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: day.branchId,
          module: "operations",
          action: "OPERATIONAL_DAY_CANCEL_BLOCKED",
          entityType: "OperationalDay",
          entityId: day.id,
          metadataJson: toJsonValue({ checklist: cancelChecklist, note: input.note }),
        },
      });
      const err = new Error("OPERATIONAL_DAY_HAS_REAL_ACTIVITY");
      (err as unknown as { checklist: typeof cancelChecklist }).checklist = cancelChecklist;
      throw err;
    }

    const cancelled = await tx.operationalDay.update({
      where: { id: day.id },
      data: {
        lifecycle: "CANCELLED",
        sweptAt: new Date(),
        sweptBySystem: false,
        sweptByUserId: input.actorUserId,
        notes: input.note,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: day.branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_CANCELLED",
        entityType: "OperationalDay",
        entityId: day.id,
        metadataJson: toJsonValue({ note: input.note, override: Boolean(input.override), checklist: cancelChecklist }),
      },
    });
    return cancelled;
  });
}

/**
 * Apertura MANUAL de un día operativo (botón Master / uso administrativo).
 * No-Master solo puede abrir HOY; Master puede elegir otra fecha con nota
 * obligatoria. Si ya existe una fila para esa fecha (cualquier lifecycle
 * salvo ACTIVE) se reactiva en vez de fallar — nunca se pierde el histórico
 * ni se corrompe el @@unique([branchId, businessDate]).
 */
export async function openOperationalDay(input: {
  branchId: string;
  businessDate?: string;
  notes?: string | null;
  actorUserId: string;
  isMaster?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${input.branchId} FOR UPDATE`;

    const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
    if (!branch?.isActive) throw new Error("BRANCH_NOT_ACTIVE");

    const businessDate = businessDateFromInput(input.businessDate);
    const today = businessDateFromNow();
    const isToday = businessDate.getTime() === today.getTime();
    const isFuture = businessDate.getTime() > today.getTime();
    if (!isToday) {
      if (!input.isMaster) {
        throw new Error(isFuture ? "OPERATIONAL_DAY_OPEN_FUTURE_NOT_ALLOWED" : "OPERATIONAL_DAY_OPEN_DATE_NOT_TODAY");
      }
      if (!input.notes?.trim()) {
        throw new Error("OPERATIONAL_DAY_OPEN_DATE_NOTE_REQUIRED");
      }
    }

    const existing = await tx.operationalDay.findUnique({
      where: { branchId_businessDate: { branchId: input.branchId, businessDate } },
    });

    if (existing) {
      if (existing.lifecycle === "ACTIVE") throw new Error("OPERATIONAL_DAY_ALREADY_OPEN");
      const wasCancelled = existing.lifecycle === "CANCELLED";
      const reviewReverted = existing.reviewStatus === "CONFIRMED";
      const reactivated = await tx.operationalDay.update({
        where: { id: existing.id },
        data: {
          lifecycle: "ACTIVE",
          sweptAt: null,
          sweptBySystem: false,
          sweptByUserId: null,
          notes: input.notes ?? existing.notes,
          ...(reviewReverted ? { reviewStatus: "PENDING", reviewedByUserId: null, reviewedAt: null } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: input.branchId,
          module: "operations",
          action: wasCancelled ? "OPERATIONAL_DAY_REACTIVATED_FROM_CANCELLED" : "OPERATIONAL_DAY_REACTIVATED",
          entityType: "OperationalDay",
          entityId: existing.id,
          metadataJson: toJsonValue({ businessDate, notes: input.notes ?? null, reviewReverted, wasCancelled }),
        },
      });
      return reactivated;
    }

    const day = await tx.operationalDay.create({
      data: {
        branchId: input.branchId,
        businessDate,
        openedByUserId: input.actorUserId,
        notes: input.notes ?? null,
      },
      include: { branch: true },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_OPENED",
        entityType: "OperationalDay",
        entityId: day.id,
        metadataJson: { branchId: input.branchId, businessDate, notes: input.notes ?? null, timezone: TIMEZONE },
      },
    });
    return day;
  });
}

export type PendingReviewDayRow = {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  businessDate: string;
  daysWaiting: number;
  salesTotal: number;
  expectedCashTotal: number;
  attention: {
    autoClosedPendingReviewCount: number;
    openOrReconcilingCashSessionsCount: number;
  };
};

/**
 * La cola única: días que dejaron de estar ACTIVE y siguen sin confirmar,
 * del más viejo al más nuevo. Ninguno bloquea la operación de hoy; ninguno
 * caduca ni se borra — esperan a que Master los confirme (confirmOperationalDay
 * ya acepta AWAITING_REVIEW).
 */
export async function listPendingReviewDays(): Promise<PendingReviewDayRow[]> {
  const days = await prisma.operationalDay.findMany({
    where: { lifecycle: "AWAITING_REVIEW", reviewStatus: "PENDING" },
    include: { branch: { select: { id: true, code: true, name: true } } },
    orderBy: { businessDate: "asc" },
    take: 100,
  });

  const today = businessDateFromNow();
  const rows: PendingReviewDayRow[] = [];
  for (const day of days) {
    const [summary, autoClosedPendingReviewCount, openOrReconcilingCashSessionsCount] = await Promise.all([
      prisma.$transaction((tx) => calculateOperationalSummaryTx(tx, day)),
      prisma.cashSession.count({
        where: { operationalDayId: day.id, status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW, requiresReview: true },
      }),
      prisma.cashSession.count({
        where: { operationalDayId: day.id, status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] } },
      }),
    ]);
    const daysWaiting = Math.round((today.getTime() - day.businessDate.getTime()) / (24 * 60 * 60 * 1000));
    rows.push({
      id: day.id,
      branchId: day.branchId,
      branchCode: day.branch.code,
      branchName: day.branch.name,
      businessDate: day.businessDate.toISOString(),
      daysWaiting,
      salesTotal: summary.salesTotal,
      expectedCashTotal: summary.expectedCashTotal,
      attention: { autoClosedPendingReviewCount, openOrReconcilingCashSessionsCount },
    });
  }
  return rows;
}
