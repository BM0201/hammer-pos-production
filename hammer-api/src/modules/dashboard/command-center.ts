import { CashSessionStatus, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserActivitySnapshot } from "@/modules/auth/presence-service";

/**
 * Centro de Comando (Command Center) snapshot.
 *
 * Consolidates, in a single payload, everything a MASTER user needs to monitor
 * the whole operation in real time:
 *   - connected / active users (presence)
 *   - cash-closure state across branches (pending review, completed today, history)
 *   - physical cash-box status per branch
 *   - current operational-day metrics per branch
 *
 * This is a read-only aggregation; it performs no writes.
 */

function dayBounds(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function num(value: { toNumber: () => number } | null | undefined): number {
  return value ? value.toNumber() : 0;
}

/** Cash sessions that still require attention (open, reconciling or pending review). */
const PENDING_STATUSES: CashSessionStatus[] = [
  CashSessionStatus.OPEN,
  CashSessionStatus.RECONCILING,
  CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW,
];

/** Cash sessions considered finalized. */
const COMPLETED_STATUSES: CashSessionStatus[] = [
  CashSessionStatus.CLOSED,
  CashSessionStatus.AUTO_CLOSED,
  CashSessionStatus.PERMANENTLY_CLOSED,
];

type CashSessionWithRefs = {
  id: string;
  status: CashSessionStatus;
  openedAt: Date;
  closedAt: Date | null;
  autoClosedAt: Date | null;
  autoClosedBySystem: boolean;
  requiresReview: boolean;
  openingAmount: { toNumber: () => number };
  expectedCashAmount: { toNumber: () => number } | null;
  countedCashAmount: { toNumber: () => number } | null;
  differenceAmount: { toNumber: () => number } | null;
  openedBy: { username: string } | null;
  closedBy: { username: string } | null;
  physicalCashBox: {
    code: string;
    description: string | null;
    branchId: string;
    branch: { code: string; name: string };
  };
};

function serializeSession(s: CashSessionWithRefs) {
  return {
    id: s.id,
    status: s.status,
    branchCode: s.physicalCashBox.branch.code,
    branchName: s.physicalCashBox.branch.name,
    boxCode: s.physicalCashBox.code,
    boxName: s.physicalCashBox.description ?? s.physicalCashBox.code,
    openedBy: s.openedBy?.username ?? null,
    closedBy: s.closedBy?.username ?? null,
    openedAt: s.openedAt.toISOString(),
    closedAt: (s.closedAt ?? s.autoClosedAt)?.toISOString() ?? null,
    autoClosedBySystem: s.autoClosedBySystem,
    requiresReview: s.requiresReview,
    openingAmount: num(s.openingAmount),
    expectedCashAmount: s.expectedCashAmount === null ? null : num(s.expectedCashAmount),
    countedCashAmount: s.countedCashAmount === null ? null : num(s.countedCashAmount),
    differenceAmount: s.differenceAmount === null ? null : num(s.differenceAmount),
  };
}

const sessionInclude = {
  openedBy: { select: { username: true } },
  closedBy: { select: { username: true } },
  physicalCashBox: {
    select: {
      code: true,
      description: true,
      branchId: true,
      branch: { select: { code: true, name: true } },
    },
  },
} as const;

export async function getCommandCenterSnapshot() {
  const { start, end } = dayBounds();

  const [
    activity,
    branches,
    physicalBoxes,
    sessionStatusGroups,
    operationalDays,
    pendingSessions,
    completedTodaySessions,
    historySessions,
    salesTodayByBranch,
  ] = await Promise.all([
    // 1. Connected users (presence) — reuse the existing snapshot.
    getUserActivitySnapshot(),
    // 2. Active branches.
    prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    // 3. Physical cash boxes.
    prisma.physicalCashBox.findMany({
      select: { id: true, branchId: true, isActive: true },
    }),
    // 4. Cash-session counts grouped by box status (we resolve branch via boxes below).
    prisma.cashSession.groupBy({
      by: ["physicalCashBoxId", "status"],
      where: { status: { in: PENDING_STATUSES } },
      _count: { _all: true },
    }),
    // 5. Today's operational day per branch.
    prisma.operationalDay.findMany({
      where: { businessDate: { gte: start, lt: end } },
      select: {
        branchId: true,
        status: true,
        salesTotal: true,
        expectedCashTotal: true,
        countedCashTotal: true,
        cashDifferenceTotal: true,
        openCashSessionsCount: true,
        autoClosedPendingReviewCount: true,
        pendingDispatchCount: true,
      },
    }),
    // 6. Pending closures (detailed list).
    prisma.cashSession.findMany({
      where: { status: { in: PENDING_STATUSES } },
      include: sessionInclude,
      orderBy: { openedAt: "asc" },
    }),
    // 7. Closures completed today (detailed list).
    prisma.cashSession.findMany({
      where: {
        status: { in: COMPLETED_STATUSES },
        OR: [
          { closedAt: { gte: start, lt: end } },
          { autoClosedAt: { gte: start, lt: end } },
        ],
      },
      include: sessionInclude,
      orderBy: { updatedAt: "desc" },
    }),
    // 8. Recent closure history (last 20, finalized).
    prisma.cashSession.findMany({
      where: { status: { in: COMPLETED_STATUSES } },
      include: sessionInclude,
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    // 9. Sales today per branch.
    prisma.saleOrder.groupBy({
      by: ["branchId"],
      where: {
        createdAt: { gte: start, lt: end },
        // Excluir ventas de prueba y anuladas de las métricas.
        isTest: false,
        voidedAt: null,
        status: {
          in: [
            SaleOrderStatus.PAID,
            SaleOrderStatus.DISPATCH_PENDING,
            SaleOrderStatus.DISPATCHED,
            SaleOrderStatus.PENDING_PAYMENT,
          ],
        },
      },
      _sum: { grandTotal: true },
    }),
  ]);

  // Map boxId -> branchId for resolving grouped session counts.
  const boxBranch = new Map(physicalBoxes.map((b) => [b.id, b.branchId]));

  // Per-branch aggregates.
  const byBranch = branches.map((branch) => {
    const boxes = physicalBoxes.filter((b) => b.branchId === branch.id);
    const day = operationalDays.find((d) => d.branchId === branch.id) ?? null;
    const sales = salesTodayByBranch.find((s) => s.branchId === branch.id);

    let openCount = 0;
    let reconcilingCount = 0;
    let pendingReviewCount = 0;
    for (const group of sessionStatusGroups) {
      if (boxBranch.get(group.physicalCashBoxId) !== branch.id) continue;
      const n = group._count._all;
      if (group.status === CashSessionStatus.OPEN) openCount += n;
      else if (group.status === CashSessionStatus.RECONCILING) reconcilingCount += n;
      else if (group.status === CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW) pendingReviewCount += n;
    }

    return {
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      boxesTotal: boxes.length,
      boxesActive: boxes.filter((b) => b.isActive).length,
      openSessions: openCount,
      reconcilingSessions: reconcilingCount,
      pendingReviewSessions: pendingReviewCount,
      salesToday: num(sales?._sum.grandTotal),
      operationalDay: day
        ? {
            status: day.status,
            salesTotal: num(day.salesTotal),
            expectedCashTotal: day.expectedCashTotal === null ? null : num(day.expectedCashTotal),
            countedCashTotal: day.countedCashTotal === null ? null : num(day.countedCashTotal),
            cashDifferenceTotal: day.cashDifferenceTotal === null ? null : num(day.cashDifferenceTotal),
            openCashSessionsCount: day.openCashSessionsCount,
            autoClosedPendingReviewCount: day.autoClosedPendingReviewCount,
            pendingDispatchCount: day.pendingDispatchCount,
          }
        : null,
    };
  });

  const pending = (pendingSessions as CashSessionWithRefs[]).map(serializeSession);
  const completedToday = (completedTodaySessions as CashSessionWithRefs[]).map(serializeSession);
  const history = (historySessions as CashSessionWithRefs[]).map(serializeSession);

  const totals = {
    salesToday: byBranch.reduce((acc, b) => acc + b.salesToday, 0),
    openSessions: byBranch.reduce((acc, b) => acc + b.openSessions, 0),
    pendingReviewSessions: byBranch.reduce((acc, b) => acc + b.pendingReviewSessions, 0),
    reconcilingSessions: byBranch.reduce((acc, b) => acc + b.reconcilingSessions, 0),
    closuresCompletedToday: completedToday.length,
    boxesActive: byBranch.reduce((acc, b) => acc + b.boxesActive, 0),
    boxesTotal: byBranch.reduce((acc, b) => acc + b.boxesTotal, 0),
    usersOnline: activity.summary.online,
    usersIdle: activity.summary.idle,
    usersOffline: activity.summary.offline,
  };

  return {
    generatedAt: new Date().toISOString(),
    totals,
    users: {
      summary: activity.summary,
      list: activity.users,
    },
    byBranch,
    cashClosures: {
      pending,
      completedToday,
      history,
    },
  };
}
