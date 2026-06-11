import { CashMovementType, CashSessionStatus, PaymentMethod, PaymentStatus, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserActivitySnapshot } from "@/modules/auth/presence-service";
import { getOperationalWindowForNow, OPERATIONAL_TIMEZONE } from "@/modules/operations/service";
import {
  commandCenterCompletedStatuses,
  commandCenterPendingStatuses,
} from "@/modules/dashboard/command-center-policy";
import { getAllBranchesSalesRealtimeSummary } from "@/modules/sales/realtime-sales-summary";

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

function num(value: { toNumber: () => number } | null | undefined): number {
  return value ? value.toNumber() : 0;
}

function movementSignedAmount(type: CashMovementType, amount: number) {
  if (
    type === CashMovementType.CASH_OUT ||
    type === CashMovementType.BANK_DEPOSIT_OUT ||
    type === CashMovementType.EXPENSE_OUT ||
    type === CashMovementType.REFUND_OUT
  ) {
    return -amount;
  }
  return amount;
}

/** Cash sessions that still require attention (open, reconciling or pending review). */
const PENDING_STATUSES = commandCenterPendingStatuses();

/** Cash sessions considered finalized. */
const COMPLETED_STATUSES = commandCenterCompletedStatuses();

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
  const { start, end } = getOperationalWindowForNow();

  const [
    activity,
    branches,
    physicalBoxes,
    sessionStatusGroups,
    operationalDays,
    pendingSessions,
    completedTodaySessions,
    historySessions,
    salesSummaries,
    dayCashSessions,
    dayTenders,
    dayCashMovements,
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
    // 9. Real-time commercial sales per branch.
    getAllBranchesSalesRealtimeSummary(),
    // 10. Cash sessions tied to today's operational day.
    prisma.cashSession.findMany({
      where: { operationalDay: { businessDate: { gte: start, lt: end } } },
      select: {
        id: true,
        status: true,
        openingAmount: true,
        physicalCashBox: { select: { branchId: true } },
      },
    }),
    // 11. Posted payment tenders in the operational window.
    prisma.paymentTender.findMany({
      where: {
        payment: {
          status: PaymentStatus.POSTED,
          paidAt: { gte: start, lt: end },
          saleOrder: { status: { not: SaleOrderStatus.CANCELLED } },
        },
      },
      select: {
        method: true,
        amount: true,
        changeAmount: true,
        payment: { select: { saleOrder: { select: { branchId: true } } } },
      },
    }),
    // 12. Cash movements registered against today's sessions.
    prisma.cashMovement.findMany({
      where: { cashSession: { operationalDay: { businessDate: { gte: start, lt: end } } } },
      select: {
        type: true,
        amount: true,
        cashSession: { select: { physicalCashBox: { select: { branchId: true } } } },
      },
    }),
  ]);

  // Map boxId -> branchId for resolving grouped session counts.
  const boxBranch = new Map(physicalBoxes.map((b) => [b.id, b.branchId]));
  const cashByBranch = new Map<
    string,
    {
      openingCashTotal: number;
      cashTenderNetTotal: number;
      cashMovementsNet: number;
      cardTenderTotal: number;
      transferTenderTotal: number;
      otherTenderTotal: number;
      activeCashSessionIds: string[];
    }
  >();

  function cashTotalsFor(branchId: string) {
    const current = cashByBranch.get(branchId);
    if (current) return current;
    const initial = {
      openingCashTotal: 0,
      cashTenderNetTotal: 0,
      cashMovementsNet: 0,
      cardTenderTotal: 0,
      transferTenderTotal: 0,
      otherTenderTotal: 0,
      activeCashSessionIds: [],
    };
    cashByBranch.set(branchId, initial);
    return initial;
  }

  for (const session of dayCashSessions) {
    const totals = cashTotalsFor(session.physicalCashBox.branchId);
    totals.openingCashTotal += num(session.openingAmount);
    if (session.status === CashSessionStatus.OPEN || session.status === CashSessionStatus.RECONCILING) {
      totals.activeCashSessionIds.push(session.id);
    }
  }

  for (const tender of dayTenders) {
    const totals = cashTotalsFor(tender.payment.saleOrder.branchId);
    const amount = num(tender.amount);
    if (tender.method === PaymentMethod.CASH) {
      totals.cashTenderNetTotal += amount - num(tender.changeAmount);
    } else if (tender.method === PaymentMethod.CARD) {
      totals.cardTenderTotal += amount;
    } else if (tender.method === PaymentMethod.TRANSFER) {
      totals.transferTenderTotal += amount;
    } else {
      totals.otherTenderTotal += amount;
    }
  }

  for (const movement of dayCashMovements) {
    const totals = cashTotalsFor(movement.cashSession.physicalCashBox.branchId);
    totals.cashMovementsNet += movementSignedAmount(movement.type, num(movement.amount));
  }

  // Per-branch aggregates.
  const byBranch = branches.map((branch) => {
    const boxes = physicalBoxes.filter((b) => b.branchId === branch.id);
    const day = operationalDays.find((d) => d.branchId === branch.id) ?? null;
    const sales = salesSummaries.find((s) => s.branchId === branch.id);
    const cash = cashTotalsFor(branch.id);
    const expectedCashOnHand = cash.openingCashTotal + cash.cashTenderNetTotal + cash.cashMovementsNet;

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
      salesToday: sales?.paidSalesTotal ?? 0,
      paidSalesCount: sales?.paidSalesCount ?? 0,
      pendingPaymentTotal: sales?.pendingPaymentTotal ?? 0,
      pendingPaymentCount: sales?.pendingPaymentCount ?? 0,
      openingCashTotal: cash.openingCashTotal,
      cashTenderNetTotal: cash.cashTenderNetTotal,
      cashMovementsNet: cash.cashMovementsNet,
      expectedCashOnHand,
      cashNetWithoutOpening: expectedCashOnHand - cash.openingCashTotal,
      cardTenderTotal: cash.cardTenderTotal,
      transferTenderTotal: cash.transferTenderTotal,
      otherTenderTotal: cash.otherTenderTotal,
      estimatedCostOfGoodsSold: null,
      estimatedGrossProfit: null,
      activeCashSessionIds: cash.activeCashSessionIds,
      lastSale: sales?.lastSale ?? null,
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
    paidSalesCount: byBranch.reduce((acc, b) => acc + b.paidSalesCount, 0),
    pendingPaymentTotal: byBranch.reduce((acc, b) => acc + b.pendingPaymentTotal, 0),
    pendingPaymentCount: byBranch.reduce((acc, b) => acc + b.pendingPaymentCount, 0),
    openingCashTotal: byBranch.reduce((acc, b) => acc + b.openingCashTotal, 0),
    cashTenderNetTotal: byBranch.reduce((acc, b) => acc + b.cashTenderNetTotal, 0),
    cashMovementsNet: byBranch.reduce((acc, b) => acc + b.cashMovementsNet, 0),
    expectedCashOnHand: byBranch.reduce((acc, b) => acc + b.expectedCashOnHand, 0),
    cashNetWithoutOpening: byBranch.reduce((acc, b) => acc + b.cashNetWithoutOpening, 0),
    cardTenderTotal: byBranch.reduce((acc, b) => acc + b.cardTenderTotal, 0),
    transferTenderTotal: byBranch.reduce((acc, b) => acc + b.transferTenderTotal, 0),
    otherTenderTotal: byBranch.reduce((acc, b) => acc + b.otherTenderTotal, 0),
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
    operationalWindow: { start: start.toISOString(), end: end.toISOString(), timezone: OPERATIONAL_TIMEZONE },
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
