import { CashSessionStatus, OperationalDayStatus, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCashAutoCloseConfig, updateCashAutoCloseConfig } from "@/modules/cash-session/auto-close-config";
import { getOperationalDayAutoConfig, updateOperationalDayAutoConfig } from "@/modules/operations/auto-day-config";
import { businessDateFromNow } from "@/modules/operations/service";

export type OperationalAutomationConfig = {
  operationalDay: {
    autoOpenEnabled: boolean;
    autoCloseEnabled: boolean;
    timezone: string;
    weekdayOpenTime: string | null;
    saturdayOpenTime: string | null;
    sundayOpenTime: string | null;
    weekdayCloseTime: string | null;
    saturdayCloseTime: string | null;
    sundayCloseTime: string | null;
    allowOpenDayWhenOpeningCashSession: boolean;
  };
  cashSessions: {
    autoCloseEnabled: boolean;
    timezone: string;
    weekdayCloseTime: string | null;
    saturdayCloseTime: string | null;
    sundayCloseTime: string | null;
    autoCloseAction: "PENDING_REVIEW" | "DIRECT_CLOSE";
  };
  safetyRules: {
    blockDayCloseWithOpenCashSessions: true;
    blockDayCloseWithReconcilingCashSessions: true;
    blockDayCloseWithPendingReviews: true;
    blockDayCloseWithPendingPayments: true;
  };
};

export type OperationalAutomationStatus = {
  currentOperationalDays: Array<{
    branchId: string;
    branchCode: string;
    branchName: string;
    operationalDayId: string | null;
    businessDate: string | null;
    status: string | null;
    openedAt: string | null;
  }>;
  staleOpenOperationalDays: Array<{
    id: string;
    branchId: string;
    branchCode: string;
    branchName: string;
    businessDate: string;
    openedAt: string;
  }>;
  cashSessions: {
    open: number;
    reconciling: number;
    autoClosedPendingReview: number;
    stalePending: number;
  };
  pendingPaymentsToday: number;
  lastAutomationRun: string | null;
  problems: string[];
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export async function getOperationalAutomationConfig(): Promise<OperationalAutomationConfig> {
  const [cashConfig, dayConfig] = await Promise.all([
    getCashAutoCloseConfig(),
    getOperationalDayAutoConfig(),
  ]);

  return {
    operationalDay: {
      autoOpenEnabled: dayConfig.autoOpenEnabled,
      autoCloseEnabled: dayConfig.autoCloseEnabled,
      timezone: dayConfig.timezone,
      weekdayOpenTime: dayConfig.weekdayOpenTime,
      saturdayOpenTime: dayConfig.saturdayOpenTime,
      sundayOpenTime: dayConfig.sundayOpenTime,
      weekdayCloseTime: dayConfig.weekdayCloseTime,
      saturdayCloseTime: dayConfig.saturdayCloseTime,
      sundayCloseTime: dayConfig.sundayCloseTime,
      allowOpenDayWhenOpeningCashSession: dayConfig.autoOpenEnabled,
    },
    cashSessions: {
      autoCloseEnabled: cashConfig.enabled,
      timezone: cashConfig.timezone,
      weekdayCloseTime: cashConfig.weekdayCloseTime,
      saturdayCloseTime: cashConfig.saturdayCloseTime,
      sundayCloseTime: cashConfig.sundayCloseTime,
      autoCloseAction: "PENDING_REVIEW",
    },
    safetyRules: {
      blockDayCloseWithOpenCashSessions: true,
      blockDayCloseWithReconcilingCashSessions: true,
      blockDayCloseWithPendingReviews: true,
      blockDayCloseWithPendingPayments: true,
    },
  };
}

export async function updateOperationalAutomationConfig(
  input: DeepPartial<OperationalAutomationConfig>,
  userId?: string,
): Promise<OperationalAutomationConfig> {
  const day = input.operationalDay;
  const cash = input.cashSessions;

  await Promise.all([
    day
      ? updateOperationalDayAutoConfig({
          autoOpenEnabled: day.autoOpenEnabled,
          autoCloseEnabled: day.autoCloseEnabled,
          timezone: day.timezone,
          weekdayOpenTime: day.weekdayOpenTime,
          saturdayOpenTime: day.saturdayOpenTime,
          sundayOpenTime: day.sundayOpenTime,
          weekdayCloseTime: day.weekdayCloseTime,
          saturdayCloseTime: day.saturdayCloseTime,
          sundayCloseTime: day.sundayCloseTime,
        }, userId)
      : Promise.resolve(),
    cash
      ? updateCashAutoCloseConfig({
          enabled: cash.autoCloseEnabled,
          timezone: cash.timezone,
          weekdayCloseTime: cash.weekdayCloseTime,
          saturdayCloseTime: cash.saturdayCloseTime,
          sundayCloseTime: cash.sundayCloseTime,
        }, userId)
      : Promise.resolve(),
  ]);

  return getOperationalAutomationConfig();
}

export async function getOperationalAutomationStatus(): Promise<OperationalAutomationStatus> {
  const today = businessDateFromNow();
  const todayStart = new Date(today.getTime() + 6 * 60 * 60 * 1000);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const [
    branches,
    todayDays,
    staleDays,
    openCash,
    reconciling,
    pendingReview,
    stalePending,
    pendingPaymentsToday,
    lastAutomationAudit,
  ] = await Promise.all([
    prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.operationalDay.findMany({
      where: { businessDate: today },
      select: { id: true, branchId: true, businessDate: true, status: true, openedAt: true },
    }),
    prisma.operationalDay.findMany({
      where: { status: OperationalDayStatus.OPEN, businessDate: { lt: today } },
      select: { id: true, branchId: true, businessDate: true, openedAt: true, branch: { select: { code: true, name: true } } },
      orderBy: { businessDate: "asc" },
      take: 25,
    }),
    prisma.cashSession.count({ where: { status: CashSessionStatus.OPEN } }),
    prisma.cashSession.count({ where: { status: CashSessionStatus.RECONCILING } }),
    prisma.cashSession.count({ where: { status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW, requiresReview: true } }),
    prisma.cashSession.count({
      where: {
        status: { in: [CashSessionStatus.RECONCILING, CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW] },
        OR: [{ operationalDayId: null }, { operationalDay: { businessDate: { lt: today } } }],
      },
    }),
    prisma.saleOrder.count({
      where: { status: SaleOrderStatus.PENDING_PAYMENT, createdAt: { gte: todayStart, lt: todayEnd } },
    }),
    prisma.auditLog.findFirst({
      where: { action: { in: ["OPERATIONAL_DAY_AUTO_OPENED", "OPERATIONAL_DAY_CLOSED", "CASH_SESSION_AUTO_CLOSED"] } },
      select: { occurredAt: true },
      orderBy: { occurredAt: "desc" },
    }),
  ]);

  const daysByBranch = new Map(todayDays.map((day) => [day.branchId, day]));
  const problems: string[] = [];
  if (staleDays.length > 0) problems.push("Hay dias operativos viejos abiertos.");
  if (openCash > 0) problems.push("Hay cajas abiertas.");
  if (reconciling > 0) problems.push("Hay cajas en conciliacion.");
  if (pendingReview > 0) problems.push("Hay cajas pendientes de revision por Master.");
  if (pendingPaymentsToday > 0) problems.push("Hay pagos pendientes del dia.");

  return {
    currentOperationalDays: branches.map((branch) => {
      const day = daysByBranch.get(branch.id);
      return {
        branchId: branch.id,
        branchCode: branch.code,
        branchName: branch.name,
        operationalDayId: day?.id ?? null,
        businessDate: day?.businessDate.toISOString() ?? null,
        status: day?.status ?? null,
        openedAt: day?.openedAt.toISOString() ?? null,
      };
    }),
    staleOpenOperationalDays: staleDays.map((day) => ({
      id: day.id,
      branchId: day.branchId,
      branchCode: day.branch.code,
      branchName: day.branch.name,
      businessDate: day.businessDate.toISOString(),
      openedAt: day.openedAt.toISOString(),
    })),
    cashSessions: {
      open: openCash,
      reconciling,
      autoClosedPendingReview: pendingReview,
      stalePending,
    },
    pendingPaymentsToday,
    lastAutomationRun: lastAutomationAudit?.occurredAt.toISOString() ?? null,
    problems,
  };
}
