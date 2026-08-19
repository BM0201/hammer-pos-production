/**
 * Force Cleanup — Master-only emergency resolution of stuck cash-session states.
 *
 * Día Operativo 360: la acción vieja "closeStaleOperationalDay" desapareció —
 * un día ACTIVE de fecha pasada ya no es un estado atascado que requiera
 * limpieza manual (resolveOperationalDayForOperationTx lo barre solo, en la
 * siguiente operación de la sucursal, o el cron periódico lo hace en minutos).
 * Lo único que sigue requiriendo intervención Master son cajas abandonadas.
 *
 * Invariantes que deben cumplirse tras ejecutar:
 *  - No se borran ventas, pagos ni logs de auditoría.
 *  - Cada acción queda registrada en AuditLog.
 *  - DRY_RUN devuelve el mismo diagnóstico pero no escribe nada.
 *  - EXECUTE exige una nota no vacía; toda escritura lleva esa nota.
 */
import { CashSessionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromNow } from "@/modules/operations/business-date";
import { refreshOperationalDaySummaryTx } from "@/modules/operations/day-summary";
import { calculateExpectedCashForSessionTx } from "@/modules/cash-session/service";

function decimal(value: number | null | undefined): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export type ForceCleanupActions = {
  closeStaleOpenCashSessions?: boolean;
  resolveAutoClosedPendingReview?: boolean;
  refreshOperationalDaySummaries?: boolean;
};

export type ForceCleanupInput = {
  branchId: string;
  mode: "DRY_RUN" | "EXECUTE";
  note: string;
  actorUserId: string;
  actions: ForceCleanupActions;
};

export type ForceCleanupDiagnosis = {
  staleOpenCashSessions: Array<{
    id: string;
    openedAt: string;
    physicalCashBoxCode: string;
    businessDate: string | null;
  }>;
  autoClosedPendingReviewSessions: Array<{
    id: string;
    autoClosedAt: string | null;
    physicalCashBoxCode: string;
    expectedCashAmount: number | null;
  }>;
  todayDayId: string | null;
};

export type ForceCleanupResult = {
  mode: "DRY_RUN" | "EXECUTE";
  branchId: string;
  diagnosis: ForceCleanupDiagnosis;
  actionsTaken: string[];
  errors: string[];
};

export async function forceCleanupBranch(input: ForceCleanupInput): Promise<ForceCleanupResult> {
  const today = businessDateFromNow();
  const isDryRun = input.mode === "DRY_RUN";

  if (!isDryRun && !input.note?.trim()) throw new Error("FORCE_CLEANUP_NOTE_REQUIRED");

  const [staleOpenSessions, autoClosedPendingSessions, todayDay] = await Promise.all([
    prisma.cashSession.findMany({
      where: {
        physicalCashBox: { branchId: input.branchId },
        status: CashSessionStatus.OPEN,
        operationalDay: { businessDate: { not: today } },
      },
      include: {
        physicalCashBox: { select: { code: true } },
        operationalDay: { select: { businessDate: true } },
      },
      orderBy: { openedAt: "asc" },
    }),
    prisma.cashSession.findMany({
      where: {
        physicalCashBox: { branchId: input.branchId },
        // Cualquier sesión todavía marcada AUTO_CLOSED_PENDING_REVIEW por STATUS,
        // sin importar requiresReview — también atrapa sesiones "medio resueltas".
        status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW,
      },
      include: { physicalCashBox: { select: { code: true } } },
      orderBy: { openedAt: "asc" },
    }),
    prisma.operationalDay.findUnique({
      where: { branchId_businessDate: { branchId: input.branchId, businessDate: today } },
      select: { id: true },
    }),
  ]);

  const diagnosis: ForceCleanupDiagnosis = {
    staleOpenCashSessions: staleOpenSessions.map((s) => ({
      id: s.id,
      openedAt: s.openedAt.toISOString(),
      physicalCashBoxCode: s.physicalCashBox.code,
      businessDate: s.operationalDay?.businessDate.toISOString() ?? null,
    })),
    autoClosedPendingReviewSessions: autoClosedPendingSessions.map((s) => ({
      id: s.id,
      autoClosedAt: s.autoClosedAt?.toISOString() ?? null,
      physicalCashBoxCode: s.physicalCashBox.code,
      expectedCashAmount: s.expectedCashAmount ? Number(s.expectedCashAmount) : null,
    })),
    todayDayId: todayDay?.id ?? null,
  };

  if (isDryRun) {
    return { mode: "DRY_RUN", branchId: input.branchId, diagnosis, actionsTaken: [], errors: [] };
  }

  const now = new Date();
  const actionsTaken: string[] = [];
  const errors: string[] = [];

  // ── Action 1: Close stale OPEN cash sessions ──────────────────────────────
  if (input.actions.closeStaleOpenCashSessions) {
    for (const session of staleOpenSessions) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "CashSession" WHERE id = ${session.id} FOR UPDATE`;
          const locked = await tx.cashSession.findUniqueOrThrow({
            where: { id: session.id },
            include: { physicalCashBox: { select: { branchId: true, code: true } } },
          });
          if (locked.status !== CashSessionStatus.OPEN) return;

          const expected = await calculateExpectedCashForSessionTx(tx, locked.id, locked.openingAmount);

          await tx.cashSession.update({
            where: { id: locked.id },
            data: {
              status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW,
              closedAt: now,
              autoClosedAt: now,
              autoClosedBySystem: false,
              autoClosedReason: `Cierre forzado MASTER. ${input.note}`,
              expectedCashAmount: decimal(expected.expectedCash),
              requiresReview: true,
              activeSessionKey: null,
            },
          });

          await tx.auditLog.create({
            data: {
              actorUserId: input.actorUserId,
              branchId: locked.physicalCashBox.branchId,
              module: "operations",
              action: "FORCE_CLEANUP_STALE_CASH_SESSION_CLOSED",
              entityType: "CashSession",
              entityId: locked.id,
              metadataJson: toJsonValue({
                note: input.note,
                physicalCashBoxCode: locked.physicalCashBox.code,
                openedAt: locked.openedAt,
                expectedCash: expected.expectedCash,
              }),
            },
          });

          await refreshOperationalDaySummaryTx(tx, locked.operationalDayId);
        });
        actionsTaken.push(`Caja ${session.physicalCashBox.code} → AUTO_CLOSED_PENDING_REVIEW.`);
      } catch (err) {
        errors.push(`Error al cerrar caja ${session.physicalCashBox.code}: ${err instanceof Error ? err.message : "UNKNOWN"}`);
      }
    }
  }

  // ── Action 2: Resolve AUTO_CLOSED_PENDING_REVIEW sessions ────────────────
  if (input.actions.resolveAutoClosedPendingReview) {
    for (const session of autoClosedPendingSessions) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "CashSession" WHERE id = ${session.id} FOR UPDATE`;
          const locked = await tx.cashSession.findUniqueOrThrow({
            where: { id: session.id },
            include: { physicalCashBox: { select: { branchId: true, code: true } } },
          });
          if (locked.status !== CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW) return;

          const counted = locked.expectedCashAmount ?? decimal(0);
          await tx.cashSession.update({
            where: { id: locked.id },
            data: {
              status: CashSessionStatus.AUTO_CLOSED,
              requiresReview: false,
              countedCashAmount: counted,
              closingAmount: counted,
              differenceAmount: decimal(0),
              closedAt: locked.closedAt ?? locked.autoClosedAt ?? now,
              reviewedAt: now,
              reviewedByUserId: input.actorUserId,
              reviewNote: `Cierre forzado MASTER. ${input.note}`,
            },
          });

          await tx.auditLog.create({
            data: {
              actorUserId: input.actorUserId,
              branchId: locked.physicalCashBox.branchId,
              module: "operations",
              action: "FORCE_CLEANUP_AUTO_CLOSED_RESOLVED",
              entityType: "CashSession",
              entityId: locked.id,
              metadataJson: toJsonValue({
                note: input.note,
                physicalCashBoxCode: locked.physicalCashBox.code,
                expectedCashAmount: locked.expectedCashAmount,
                acceptedAsCounted: true,
              }),
            },
          });

          await refreshOperationalDaySummaryTx(tx, locked.operationalDayId);
        });
        actionsTaken.push(`Sesión auto-cerrada ${session.physicalCashBox.code} revisada y aceptada por MASTER.`);
      } catch (err) {
        errors.push(`Error al resolver sesión ${session.physicalCashBox.code}: ${err instanceof Error ? err.message : "UNKNOWN"}`);
      }
    }
  }

  // ── Action 3: Refresh today's operational day summary ────────────────────
  if (input.actions.refreshOperationalDaySummaries && todayDay) {
    try {
      await prisma.$transaction((tx) => refreshOperationalDaySummaryTx(tx, todayDay.id));
      actionsTaken.push(`Summary del día actual actualizado.`);
    } catch (err) {
      errors.push(`Error al refrescar summary: ${err instanceof Error ? err.message : "UNKNOWN"}`);
    }
  }

  if (actionsTaken.length > 0 || errors.length > 0) {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        module: "operations",
        action: "FORCE_CLEANUP_EXECUTED",
        entityType: "Branch",
        entityId: input.branchId,
        metadataJson: toJsonValue({ note: input.note, actionsTaken, errors }),
      },
    });
  }

  return { mode: "EXECUTE", branchId: input.branchId, diagnosis, actionsTaken, errors };
}
