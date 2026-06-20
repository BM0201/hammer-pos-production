import { CashSessionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { autoCloseExpiredCashSessions, getCashAutoCloseDeadline } from "@/modules/cash-session/auto-close-service";

const NICARAGUA_TZ = "America/Managua";

/* ── Helpers ── */

function getNicaraguaDate(date?: Date): Date {
  const d = date ?? new Date();
  const niFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: NICARAGUA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = niFormatter.format(d);
  return new Date(parts + "T00:00:00.000Z");
}

export function isAfterAutoCloseTime(date?: Date): boolean {
  return getCashAutoCloseDeadline({ id: "legacy-cash-closure-adapter" }, date ?? new Date()).expired;
}

/* ── Get today's closure for a branch ── */

export async function getTodayClosure(branchId: string): Promise<{
  closure: Awaited<ReturnType<typeof prisma.cashClosure.findFirst>>;
  isClosed: boolean;
  canSell: boolean;
  legacy: true;
  source: "OperationalDay";
  operationalDay: Awaited<ReturnType<typeof prisma.operationalDay.findFirst>>;
  openCashSessionCount: number;
  autoClosedPendingReviewCount: number;
}> {
  const today = getNicaraguaDate();
  const [closure, operationalDay, openCashSessionCount, autoClosedPendingReviewCount] = await Promise.all([
    prisma.cashClosure.findFirst({ where: { branchId, closureDate: today } }),
    prisma.operationalDay.findFirst({
      where: { branchId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    }),
    prisma.cashSession.count({
      where: {
        status: CashSessionStatus.OPEN,
        activeSessionKey: { not: null },
        physicalCashBox: { branchId },
        operationalDay: { status: "OPEN" },
      },
    }),
    prisma.cashSession.count({
      where: {
        status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW,
        requiresReview: true,
        physicalCashBox: { branchId },
      },
    }),
  ]);

  await logAuditEvent({
    branchId,
    module: "cash_closure",
    action: "CASH_CLOSURE_LEGACY_ADAPTER_USED",
    entityType: "CashClosure",
    entityId: closure?.id ?? branchId,
    metadataJson: {
      source: "OperationalDay",
      operationalDayId: operationalDay?.id ?? null,
      openCashSessionCount,
      autoClosedPendingReviewCount,
    },
  });

  // A stale OPEN day (businessDate !== today) must not grant canSell or be surfaced as open.
  const effectiveOperationalDay =
    operationalDay && operationalDay.businessDate.getTime() === today.getTime()
      ? operationalDay
      : null;

  return {
    closure,
    isClosed: effectiveOperationalDay?.status !== "OPEN",
    canSell: effectiveOperationalDay?.status === "OPEN" && openCashSessionCount > 0,
    legacy: true,
    source: "OperationalDay",
    operationalDay: effectiveOperationalDay,
    openCashSessionCount,
    autoClosedPendingReviewCount,
  };
}

/* ── Execute automatic closure for a single branch ── */

export async function executeAutoClosure(branchId: string): Promise<{
  branchId: string;
  legacy: true;
  source: "CashSessionAutoClose";
  scanned: number;
  autoClosed: number;
  skipped: number;
}> {
  const result = await autoCloseExpiredCashSessions({ branchId });
  const branchCandidates = result.candidates.filter((candidate) => candidate.branchId === branchId);
  await logAuditEvent({
    branchId,
    module: "cash_closure",
    action: "CASH_CLOSURE_LEGACY_ADAPTER_USED",
    entityType: "CashClosure",
    entityId: branchId,
    metadataJson: { source: "CashSessionAutoClose", result },
  });
  return {
    branchId,
    legacy: true,
    source: "CashSessionAutoClose",
    scanned: branchCandidates.length,
    autoClosed: branchCandidates.length,
    skipped: result.skipped,
  };
}

/* ── Execute automatic closure for ALL active branches ── */

export async function executeAutoClosureForAllBranches(): Promise<{
  legacy: true;
  source: "CashSessionAutoClose";
  scanned: number;
  autoClosed: number;
  skipped: number;
  errors: Array<{ cashSessionId: string; message: string }>;
  candidates: Array<{ cashSessionId: string; branchId: string; physicalCashBoxId: string; deadline: string; timezone: string }>;
}> {
  const result = await autoCloseExpiredCashSessions();
  await logAuditEvent({
    module: "cash_closure",
    action: "CASH_CLOSURE_LEGACY_ADAPTER_USED",
    entityType: "CashClosure",
    entityId: "auto-close-all-branches",
    metadataJson: { source: "CashSessionAutoClose", result },
  });
  return { legacy: true, source: "CashSessionAutoClose", ...result };
}

/* ── Emergency Reopening ── */

export async function reopenCashClosure(input: {
  branchId: string;
  actorUserId: string;
  reason?: string;
}): Promise<{ closure: NonNullable<Awaited<ReturnType<typeof prisma.cashClosure.findFirst>>> }> {
  const today = getNicaraguaDate();

  const closure = await prisma.cashClosure.findFirst({
    where: { branchId: input.branchId, closureDate: today },
  });

  if (!closure) {
    throw new Error("NO_CLOSURE_TO_REOPEN");
  }

  if (closure.isPermanentlyClosed) {
    throw new Error("CLOSURE_PERMANENTLY_CLOSED");
  }

  // Update the closure to reopened state
  const updated = await prisma.cashClosure.update({
    where: { id: closure.id },
    data: {
      isReopened: true,
      reopenedAt: new Date(),
      reopenedByUserId: input.actorUserId,
      reopenCount: { increment: 1 },
      emergencySalesCount: 0, // Reset counter on each reopen
    },
  });

  await prisma.cashClosureLog.create({
    data: {
      cashClosureId: closure.id,
      action: "REOPEN",
      performedByUserId: input.actorUserId,
      metadataJson: {
        reason: input.reason ?? "Emergency reopening",
        reopenCount: updated.reopenCount,
      } as unknown as Prisma.JsonObject,
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "cash_closure",
    action: "EMERGENCY_REOPEN",
    entityType: "CashClosure",
    entityId: closure.id,
    metadataJson: {
      reason: input.reason ?? "Emergency reopening",
      reopenCount: updated.reopenCount,
    },
  });

  return { closure: updated };
}

/* ── Record emergency sale and check if permanent close needed ── */

export async function recordEmergencySale(branchId: string, saleOrderId: string, actorUserId: string): Promise<{
  remainingSales: number;
  permanentlyClosed: boolean;
}> {
  const today = getNicaraguaDate();

  const closure = await prisma.cashClosure.findFirst({
    where: { branchId, closureDate: today, isReopened: true, isPermanentlyClosed: false },
  });

  if (!closure) {
    return { remainingSales: 0, permanentlyClosed: false };
  }

  const newCount = closure.emergencySalesCount + 1;
  const shouldPermanentlyClose = newCount >= closure.maxEmergencySales;

  await prisma.cashClosure.update({
    where: { id: closure.id },
    data: {
      emergencySalesCount: newCount,
      isPermanentlyClosed: shouldPermanentlyClose,
      closureType: shouldPermanentlyClose ? "PERMANENT" : closure.closureType,
    },
  });

  await prisma.cashClosureLog.create({
    data: {
      cashClosureId: closure.id,
      action: shouldPermanentlyClose ? "PERMANENT_CLOSE" : "EMERGENCY_SALE",
      performedByUserId: actorUserId,
      metadataJson: {
        saleOrderId,
        emergencySalesCount: newCount,
        maxEmergencySales: closure.maxEmergencySales,
      } as unknown as Prisma.JsonObject,
    },
  });

  await logAuditEvent({
    actorUserId,
    branchId,
    module: "cash_closure",
    action: "CASH_CLOSURE_LEGACY_ADAPTER_USED",
    entityType: "CashClosure",
    entityId: closure.id,
    metadataJson: {
      reason: "LEGACY_EMERGENCY_SALE_COUNTER_ONLY",
      saleOrderId,
      emergencySalesCount: newCount,
      wouldHavePermanentlyClosedLegacyClosure: shouldPermanentlyClose,
    },
  });

  return {
    remainingSales: Math.max(0, closure.maxEmergencySales - newCount),
    permanentlyClosed: shouldPermanentlyClose,
  };
}

/* ── Fetch closure reports for master dashboard ── */

export async function getClosureReports(params: {
  branchId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}) {
  const where: Prisma.CashClosureWhereInput = {};

  if (params.branchId) {
    where.branchId = params.branchId;
  }

  if (params.startDate || params.endDate) {
    where.closureDate = {};
    if (params.startDate) {
      where.closureDate.gte = new Date(params.startDate);
    }
    if (params.endDate) {
      where.closureDate.lte = new Date(params.endDate);
    }
  }

  const page = params.page ?? 1;
  const limit = params.limit ?? 50;

  const [closures, total] = await Promise.all([
    prisma.cashClosure.findMany({
      where,
      include: {
        branch: { select: { id: true, code: true, name: true } },
        logs: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { closureDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.cashClosure.count({ where }),
  ]);

  return { closures, total, page, limit };
}
