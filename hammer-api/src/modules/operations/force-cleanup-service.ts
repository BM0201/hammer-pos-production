/**
 * Force Cleanup — Master-only emergency resolution of stuck operational states.
 *
 * Invariants that must hold after execution:
 *  - No sales, payments or audit logs are deleted.
 *  - Every action is recorded in AuditLog.
 *  - DRY_RUN returns an identical diagnosis object but performs no writes.
 *  - EXECUTE requires a non-empty note; every write carries that note.
 */
import { CashSessionStatus, OperationalDayStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  businessDateFromNow,
  calculateOperationalSummaryTx,
  refreshOperationalDaySummaryTx,
} from "@/modules/operations/service";
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
  closeStaleOperationalDay?: boolean;
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
  staleOpenOperationalDays: Array<{ id: string; businessDate: string; status: string }>;
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

  // ── Gather full diagnosis (always, even for EXECUTE) ─────────────────────
  const [staleOpenSessions, autoClosedPendingSessions, staleOpenDays, todayDay] = await Promise.all([
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
        // Match every session still flagged as pending review by STATUS, regardless
        // of the requiresReview flag. This also catches "half-resolved" sessions
        // left in a broken state by the previous bug (requiresReview=false but
        // status never advanced past AUTO_CLOSED_PENDING_REVIEW), so a single
        // force-cleanup run can finalize them.
        status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW,
      },
      include: { physicalCashBox: { select: { code: true } } },
      orderBy: { openedAt: "asc" },
    }),
    prisma.operationalDay.findMany({
      where: {
        branchId: input.branchId,
        status: OperationalDayStatus.OPEN,
        businessDate: { not: today },
      },
      orderBy: { businessDate: "desc" },
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
    staleOpenOperationalDays: staleOpenDays.map((d) => ({
      id: d.id,
      businessDate: d.businessDate.toISOString(),
      status: d.status,
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

          // Accept expected cash as the official count. Master takes responsibility via note + audit log.
          const counted = locked.expectedCashAmount ?? decimal(0);
          await tx.cashSession.update({
            where: { id: locked.id },
            data: {
              // CRITICAL: advance the status to AUTO_CLOSED. Previously only
              // requiresReview/counted/difference were updated, which left the
              // session stuck at AUTO_CLOSED_PENDING_REVIEW forever — the command
              // center classifies by status, so it kept showing as "Pendiente de
              // revisión" and the OK action (which requires requiresReview=true)
              // could no longer clear it.
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

  // ── Action 3: Close stale OPEN operational days ───────────────────────────
  if (input.actions.closeStaleOperationalDay) {
    for (const day of staleOpenDays) {
      try {
        const blockingSessions = await prisma.cashSession.count({
          where: {
            operationalDayId: day.id,
            status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] },
          },
        });
        if (blockingSessions > 0) {
          errors.push(
            `Día ${day.businessDate.toISOString().split("T")[0]}: ${blockingSessions} caja(s) abiertas o en conciliación. Ciérralas primero con 'closeStaleOpenCashSessions'.`,
          );
          continue;
        }

        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${day.id} FOR UPDATE`;
          const locked = await tx.operationalDay.findUniqueOrThrow({ where: { id: day.id } });
          if (locked.status !== OperationalDayStatus.OPEN) return;

          const summary = await calculateOperationalSummaryTx(tx, locked);

          await tx.operationalDay.update({
            where: { id: locked.id },
            data: {
              status: OperationalDayStatus.CLOSED,
              closedAt: now,
              closedByUserId: input.actorUserId,
              notes: input.note,
              summaryJson: toJsonValue(summary),
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
              branchId: locked.branchId,
              module: "operations",
              action: "FORCE_CLEANUP_STALE_DAY_CLOSED",
              entityType: "OperationalDay",
              entityId: locked.id,
              metadataJson: toJsonValue({ note: input.note, businessDate: locked.businessDate }),
            },
          });
        });
        actionsTaken.push(`Día ${day.businessDate.toISOString().split("T")[0]} cerrado → CLOSED (pendiente aprobación MASTER).`);
      } catch (err) {
        errors.push(`Error al cerrar día ${day.businessDate.toISOString().split("T")[0]}: ${err instanceof Error ? err.message : "UNKNOWN"}`);
      }
    }
  }

  // ── Action 4: Refresh today's operational day summary ────────────────────
  if (input.actions.refreshOperationalDaySummaries && todayDay) {
    try {
      await prisma.$transaction((tx) => refreshOperationalDaySummaryTx(tx, todayDay.id));
      actionsTaken.push(`Summary del día actual actualizado.`);
    } catch (err) {
      errors.push(`Error al refrescar summary: ${err instanceof Error ? err.message : "UNKNOWN"}`);
    }
  }

  // ── Global audit entry ────────────────────────────────────────────────────
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
