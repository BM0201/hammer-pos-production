import { OperationalDayStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  openOperationalDay,
  closeOperationalDay,
  businessDateFromNow,
  computeApprovalBlockers,
} from "@/modules/operations/service";
import {
  getOperationalDayAutoConfig,
  type OperationalDayAutoConfig,
  DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG,
} from "@/modules/operations/auto-day-config";
import { getApprovalPolicy } from "@/modules/operations/approve-policy-config";

function n(value: Prisma.Decimal | number | string | null | undefined): number {
  return Number(value ?? 0);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const DEFAULT_TIMEZONE = "America/Managua";

type LocalParts = { weekday: string; hour: number; minute: number };

function localParts(now: Date, timezone = DEFAULT_TIMEZONE): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  return {
    weekday: byType.get("weekday") ?? "Sunday",
    hour: Number(byType.get("hour") ?? 0),
    minute: Number(byType.get("minute") ?? 0),
  };
}

function resolveTimeForDay(
  weekday: string,
  config: Pick<OperationalDayAutoConfig, "weekdayOpenTime" | "saturdayOpenTime" | "sundayOpenTime">,
): string | null;
function resolveTimeForDay(
  weekday: string,
  config: Pick<OperationalDayAutoConfig, "weekdayCloseTime" | "saturdayCloseTime" | "sundayCloseTime">,
): string | null;
function resolveTimeForDay(weekday: string, config: Record<string, string | null>): string | null {
  if (weekday === "saturday") return config["saturdayOpenTime"] ?? config["saturdayCloseTime"] ?? null;
  if (weekday === "sunday") return config["sundayOpenTime"] ?? config["sundayCloseTime"] ?? null;
  return config["weekdayOpenTime"] ?? config["weekdayCloseTime"] ?? null;
}

function hasTimePassed(targetTime: string, parts: LocalParts): boolean {
  const [h, m] = targetTime.split(":").map(Number);
  return parts.hour * 60 + parts.minute >= h * 60 + m;
}

export function getOperationalDayOpenDeadline(
  now: Date,
  config: OperationalDayAutoConfig = DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG,
) {
  const timezone = config.timezone || DEFAULT_TIMEZONE;
  if (!config.autoOpenEnabled) return { enabled: false, timezone, openTime: null, passed: false };

  const parts = localParts(now, timezone);
  const openTime = parts.weekday === "saturday"
    ? config.saturdayOpenTime
    : parts.weekday === "sunday"
      ? config.sundayOpenTime
      : config.weekdayOpenTime;

  if (!openTime) return { enabled: false, timezone, openTime: null, passed: false };
  return { enabled: true, timezone, openTime, passed: hasTimePassed(openTime, parts) };
}

export function getOperationalDayCloseDeadline(
  now: Date,
  config: OperationalDayAutoConfig = DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG,
) {
  const timezone = config.timezone || DEFAULT_TIMEZONE;
  if (!config.autoCloseEnabled) return { enabled: false, timezone, closeTime: null, passed: false };

  const parts = localParts(now, timezone);
  const closeTime = parts.weekday === "saturday"
    ? config.saturdayCloseTime
    : parts.weekday === "sunday"
      ? config.sundayCloseTime
      : config.weekdayCloseTime;

  if (!closeTime) return { enabled: false, timezone, closeTime: null, passed: false };
  return { enabled: true, timezone, closeTime, passed: hasTimePassed(closeTime, parts) };
}

type AutoDayResult = {
  scanned: number;
  opened: number;
  closed: number;
  approved?: number;
  skipped: number;
  errors: Array<{ branchId: string; message: string }>;
};

export async function autoOpenOperationalDays(input: { now?: Date; dryRun?: boolean } = {}): Promise<AutoDayResult> {
  const now = input.now ?? new Date();
  const dryRun = Boolean(input.dryRun);

  const config = await getOperationalDayAutoConfig();
  const deadline = getOperationalDayOpenDeadline(now, config);

  const result: AutoDayResult = { scanned: 0, opened: 0, closed: 0, skipped: 0, errors: [] };

  if (!deadline.enabled || !deadline.passed) return result;

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  result.scanned = branches.length;
  const todayBizDate = businessDateFromNow(now);

  for (const branch of branches) {
    try {
      const existing = await prisma.operationalDay.findFirst({
        where: { branchId: branch.id, businessDate: todayBizDate },
        select: { id: true, status: true },
      });

      if (existing) {
        result.skipped++;
        continue;
      }

      const openDay = await prisma.operationalDay.findFirst({
        where: { branchId: branch.id, status: OperationalDayStatus.OPEN },
        select: { id: true, businessDate: true },
      });

      if (openDay) {
        result.skipped++;
        continue;
      }

      if (!dryRun) {
        await openOperationalDay({ branchId: branch.id, actorUserId: "SYSTEM", notes: "Apertura automática por horario." });
      }
      result.opened++;
    } catch (err) {
      result.errors.push({ branchId: branch.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}

export async function autoCloseOperationalDays(input: { now?: Date; dryRun?: boolean } = {}): Promise<AutoDayResult> {
  const now = input.now ?? new Date();
  const dryRun = Boolean(input.dryRun);

  const config = await getOperationalDayAutoConfig();
  const deadline = getOperationalDayCloseDeadline(now, config);

  const result: AutoDayResult = { scanned: 0, opened: 0, closed: 0, skipped: 0, errors: [] };

  if (!deadline.enabled || !deadline.passed) return result;

  const todayBizDate = businessDateFromNow(now);
  const openDays = await prisma.operationalDay.findMany({
    where: { status: OperationalDayStatus.OPEN, businessDate: todayBizDate },
    select: { id: true, branchId: true },
  });
  const staleOpenDays = await prisma.operationalDay.findMany({
    where: { status: OperationalDayStatus.OPEN, businessDate: { lt: todayBizDate } },
    select: { id: true, branchId: true, businessDate: true },
    take: 50,
  });

  result.scanned = openDays.length + staleOpenDays.length;
  result.skipped += staleOpenDays.length;
  for (const stale of staleOpenDays) {
    result.errors.push({
      branchId: stale.branchId,
      message: `STALE_OPEN_OPERATIONAL_DAY:${stale.id}:${stale.businessDate.toISOString()}`,
    });
  }

  for (const day of openDays) {
    try {
      if (!dryRun) {
        await closeOperationalDay({
          id: day.id,
          actorUserId: "SYSTEM",
          note: "Cierre automático por horario operativo.",
          forceClose: true,
          isMaster: true,
        });
      }
      result.closed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "OPERATIONAL_DAY_HAS_HARD_BLOCKERS") {
        result.skipped++;
      } else {
        result.errors.push({ branchId: day.branchId, message: msg });
      }
    }
  }

  return result;
}

export async function autoApproveOperationalDays(
  input: { now?: Date; dryRun?: boolean } = {},
): Promise<AutoDayResult> {
  const now = input.now ?? new Date();
  const dryRun = Boolean(input.dryRun);

  const result: AutoDayResult = { scanned: 0, opened: 0, closed: 0, approved: 0, skipped: 0, errors: [] };

  const policy = await getApprovalPolicy();
  if (!policy.autoApproveEnabled) return result;

  const cutoffTime = new Date(now.getTime() - policy.autoApproveAfterHours * 3600_000);

  const candidates = await prisma.operationalDay.findMany({
    where: {
      status: OperationalDayStatus.CLOSED,
      approvedAt: null,
      closedAt: { lte: cutoffTime },
    },
    select: { id: true, branchId: true },
    take: 100,
  });

  result.scanned = candidates.length;

  for (const candidate of candidates) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${candidate.id} FOR UPDATE`;
        const day = await tx.operationalDay.findUnique({ where: { id: candidate.id } });

        // Idempotency / state re-check after acquiring the lock.
        if (!day || day.status !== OperationalDayStatus.CLOSED || day.approvedAt) {
          result.skipped++;
          return;
        }

        const { blockers } = await computeApprovalBlockers(tx, day);
        if (blockers.length > 0) {
          result.skipped++;
          return;
        }

        if (Math.abs(n(day.cashDifferenceTotal)) > policy.autoApproveMaxCashDifference) {
          result.skipped++;
          return;
        }

        if (dryRun) {
          result.approved!++;
          return;
        }

        await tx.operationalDay.update({
          where: { id: day.id },
          data: {
            approvedByMasterId: "SYSTEM",
            approvedAt: new Date(),
            approvalSummaryJson: day.summaryJson ?? undefined,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: "SYSTEM",
            branchId: day.branchId,
            module: "operations",
            action: "OPERATIONAL_DAY_AUTO_APPROVED",
            entityType: "OperationalDay",
            entityId: day.id,
            metadataJson: toJsonValue({
              policy: {
                autoApproveAfterHours: policy.autoApproveAfterHours,
                autoApproveMaxCashDifference: policy.autoApproveMaxCashDifference,
              },
              cashDifferenceTotal: n(day.cashDifferenceTotal),
            }),
          },
        });

        result.approved!++;
      });
    } catch (err) {
      result.errors.push({
        branchId: candidate.branchId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// Re-export for use by resolveTimeForDay consumers
export { resolveTimeForDay };
