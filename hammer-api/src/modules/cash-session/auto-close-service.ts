import {
  BrainDecisionCategory,
  BrainDecisionSeverity,
  CashSessionStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CASH_SESSION_AUDIT_EVENTS } from "@/modules/cash-session/audit-events";
import { calculateExpectedCashForSessionTx } from "@/modules/cash-session/service";
import { refreshOperationalDaySummaryTx } from "@/modules/operations/service";
import {
  DEFAULT_CASH_AUTO_CLOSE_CONFIG,
  getCashAutoCloseConfig,
  type CashAutoCloseConfig,
} from "@/modules/cash-session/auto-close-config";

const DEFAULT_TIMEZONE = "America/Managua";
const AUTO_CLOSE_REASON = "Cierre automatico por horario operativo.";

type AutoCloseActor = "SYSTEM" | string;

type AutoCloseResult = {
  scanned: number;
  autoClosed: number;
  wouldAutoClose: number;
  skipped: number;
  errors: Array<{ cashSessionId: string; message: string }>;
  candidates: Array<{
    cashSessionId: string;
    branchId: string;
    physicalCashBoxId: string;
    deadline: string;
    timezone: string;
  }>;
};

type LocalParts = {
  weekday: string;
  hour: number;
  minute: number;
};

function localParts(now: Date, timezone = DEFAULT_TIMEZONE): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    weekday: byType.get("weekday") ?? "Sunday",
    hour: Number(byType.get("hour") ?? 0),
    minute: Number(byType.get("minute") ?? 0),
  };
}

/**
 * Resolve the auto-close deadline for "now" given a configuration.
 *
 * The closing time is configurable per day-type (weekday / Saturday / Sunday) and
 * defaults to 17:30 (5:30 PM) on weekdays, 16:00 on Saturdays, disabled on Sundays.
 * Pure function (no I/O) — the caller passes the config it loaded once.
 */
export function getCashAutoCloseDeadline(
  _branch: { id: string },
  now: Date,
  config: CashAutoCloseConfig = DEFAULT_CASH_AUTO_CLOSE_CONFIG,
) {
  const timezone = config.timezone || DEFAULT_TIMEZONE;

  if (!config.enabled) {
    return { enabled: false, timezone, closeTime: null, expired: false, rule: "DISABLED" };
  }

  const parts = localParts(now, timezone);
  const weekday = parts.weekday.toLowerCase();
  const closeTime = weekday === "saturday"
    ? config.saturdayCloseTime
    : weekday === "sunday"
      ? config.sundayCloseTime
      : config.weekdayCloseTime;

  if (!closeTime) {
    return {
      enabled: false,
      timezone,
      closeTime: null,
      expired: false,
      rule: weekday === "sunday" ? "SUNDAY_DISABLED" : "DISABLED",
    };
  }

  const [deadlineHour, deadlineMinute] = closeTime.split(":").map(Number);
  const currentMinutes = parts.hour * 60 + parts.minute;
  const deadlineMinutes = deadlineHour * 60 + deadlineMinute;

  return {
    enabled: true,
    timezone,
    closeTime,
    expired: currentMinutes >= deadlineMinutes,
    rule: weekday === "saturday" ? "SATURDAY" : weekday === "sunday" ? "SUNDAY" : "WEEKDAY",
  };
}

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

async function calculateSessionPaymentTotalsTx(tx: Prisma.TransactionClient, cashSessionId: string) {
  const rows = await tx.payment.groupBy({
    by: ["method"],
    where: { cashSessionId, status: "POSTED" },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return rows.map((row) => ({
    method: row.method,
    amount: Number(row._sum.amount ?? 0),
    count: row._count._all,
  }));
}

function actorUserIdForAudit(actor?: AutoCloseActor) {
  return actor && actor !== "SYSTEM" ? actor : null;
}

export async function autoCloseExpiredCashSessions(input: {
  now?: Date;
  dryRun?: boolean;
  actor?: AutoCloseActor;
} = {}): Promise<AutoCloseResult> {
  const now = input.now ?? new Date();
  const dryRun = Boolean(input.dryRun);
  const actorUserId = actorUserIdForAudit(input.actor ?? "SYSTEM");
  const config = await getCashAutoCloseConfig();

  const openSessions = await prisma.cashSession.findMany({
    where: { status: CashSessionStatus.OPEN },
    include: {
      physicalCashBox: { include: { branch: true } },
      openedBy: { select: { id: true, username: true, fullName: true } },
    },
    orderBy: { openedAt: "asc" },
  });

  const result: AutoCloseResult = {
    scanned: openSessions.length,
    autoClosed: 0,
    wouldAutoClose: 0,
    skipped: 0,
    errors: [],
    candidates: [],
  };

  for (const session of openSessions) {
    const deadline = getCashAutoCloseDeadline(session.physicalCashBox.branch, now, config);

    if (!deadline.enabled || !deadline.expired) {
      result.skipped += 1;
      continue;
    }

    result.candidates.push({
      cashSessionId: session.id,
      branchId: session.physicalCashBox.branchId,
      physicalCashBoxId: session.physicalCashBoxId,
      deadline: deadline.closeTime ?? "disabled",
      timezone: deadline.timezone,
    });

    if (dryRun) {
      result.wouldAutoClose += 1;
      continue;
    }

    try {
      const closed = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT id
          FROM "CashSession"
          WHERE id = ${session.id}
          FOR UPDATE
        `;

        const locked = await tx.cashSession.findUniqueOrThrow({
          where: { id: session.id },
          include: { physicalCashBox: { include: { branch: true } } },
        });

        if (locked.status !== CashSessionStatus.OPEN) return false;

        const expected = await calculateExpectedCashForSessionTx(tx, locked.id, locked.openingAmount);
        const paymentTotals = await calculateSessionPaymentTotalsTx(tx, locked.id);

        const updated = await tx.cashSession.update({
          where: { id: locked.id },
          data: {
            status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW,
            closedAt: now,
            autoClosedAt: now,
            autoClosedBySystem: true,
            autoClosedReason: AUTO_CLOSE_REASON,
            expectedCashAmount: decimal(expected.expectedCash),
            countedCashAmount: null,
            differenceAmount: null,
            closingAmount: null,
            requiresReview: true,
            activeSessionKey: null,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            branchId: locked.physicalCashBox.branchId,
            module: "cash_session",
            action: CASH_SESSION_AUDIT_EVENTS.AUTO_CLOSED,
            entityType: "CashSession",
            entityId: locked.id,
            metadataJson: {
              branchId: locked.physicalCashBox.branchId,
              physicalCashBoxId: locked.physicalCashBoxId,
              openedAt: locked.openedAt,
              autoClosedAt: now,
              expectedTotals: expected,
              paymentTotals,
              scheduleRule: deadline.rule,
              closeTime: deadline.closeTime,
              timezone: deadline.timezone,
              reason: AUTO_CLOSE_REASON,
            },
          },
        });
        await refreshOperationalDaySummaryTx(tx, locked.operationalDayId);

        await tx.brainDecision.upsert({
          where: { fingerprint: `cash:auto-close-review:${locked.id}` },
          create: {
            category: BrainDecisionCategory.CASH,
            severity: BrainDecisionSeverity.HIGH,
            title: "Caja cerrada automaticamente pendiente de revision",
            description: `La caja ${locked.physicalCashBox.code} de la sucursal ${locked.physicalCashBox.branch.name} fue cerrada automaticamente por horario operativo y requiere conteo/revision.`,
            recommendation: "Revisar cierre de caja e ingresar monto contado.",
            branchId: locked.physicalCashBox.branchId,
            confidenceScore: decimal(1),
            impactAmount: decimal(expected.expectedCash),
            riskScore: decimal(80),
            proposedActionType: "REVIEW_CASH_SESSION",
            evidenceJson: {
              cashSessionId: locked.id,
              physicalCashBoxId: locked.physicalCashBoxId,
              expectedCash: expected.expectedCash,
              expectedTotals: expected,
              paymentTotals,
              autoClosedAt: updated.autoClosedAt,
              timezone: deadline.timezone,
              closeTime: deadline.closeTime,
            },
            fingerprint: `cash:auto-close-review:${locked.id}`,
          },
          update: {
            status: "OPEN",
            evidenceJson: {
              cashSessionId: locked.id,
              physicalCashBoxId: locked.physicalCashBoxId,
              expectedCash: expected.expectedCash,
              expectedTotals: expected,
              paymentTotals,
              autoClosedAt: updated.autoClosedAt,
              timezone: deadline.timezone,
              closeTime: deadline.closeTime,
            },
          },
        });

        return true;
      });

      if (closed) result.autoClosed += 1;
      else result.skipped += 1;
    } catch (error) {
      result.errors.push({
        cashSessionId: session.id,
        message: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      });
    }
  }

  return result;
}
