import {
  BrainDecisionCategory,
  BrainDecisionSeverity,
  CashMovementType,
  CashSessionStatus,
  OperationalDayStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SaleOrderStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OperationalDayClosePreview, ChecklistItem } from "@/modules/operations/types";
import { isHardOperationalDayCloseBlocker } from "@/modules/operations/close-policy";
import { isHardApproveBlocker } from "@/modules/operations/approve-policy";
import { getSalesSummaryForOperationalDayTx } from "@/modules/sales/realtime-sales-summary";
import { OPERATIONAL_DAY_AUTO_SETTING_KEY, normalizeOperationalDayAutoConfig } from "@/modules/operations/auto-day-config";

export const OPERATIONAL_TIMEZONE = "America/Managua";
const TIMEZONE = OPERATIONAL_TIMEZONE;
const ACTIVE_DISPATCH_STATUSES = ["PENDING", "IN_PROGRESS"] as const;
function decimal(value: number) {
  return new Prisma.Decimal(Number.isFinite(value) ? value : 0);
}

function n(value: Prisma.Decimal | number | string | null | undefined) {
  return Number(value ?? 0);
}

function isCashOutflow(type: CashMovementType) {
  return (
    type === CashMovementType.CASH_OUT ||
    type === CashMovementType.BANK_DEPOSIT_OUT ||
    type === CashMovementType.EXPENSE_OUT ||
    type === CashMovementType.REFUND_OUT
  );
}

function movementSignedAmount(type: CashMovementType, amount: number) {
  return isCashOutflow(type) ? -amount : amount;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function localDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = formatter.format(date).split("-").map(Number);
  return { year, month, day };
}

export function businessDateFromNow(now = new Date()) {
  const { year, month, day } = localDateParts(now);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

export function businessDateFromInput(input?: string) {
  if (!input) return businessDateFromNow();
  const [year, month, day] = input.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function operationalWindow(businessDate: Date) {
  const year = businessDate.getUTCFullYear();
  const month = businessDate.getUTCMonth();
  const day = businessDate.getUTCDate();
  const start = new Date(Date.UTC(year, month, day, 6, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function getOperationalWindowForNow(now = new Date()) {
  return operationalWindow(businessDateFromNow(now));
}

export async function calculateOperationalSummaryTx(tx: Prisma.TransactionClient, day: { id: string; branchId: string; businessDate: Date }) {
  const { start, end } = operationalWindow(day.businessDate);
  const salesSummary = await getSalesSummaryForOperationalDayTx(tx, day.id);
  const [
    openCashSessionsCount,
    autoClosedPendingReviewCount,
    pendingDispatchCount,
    criticalBrainDecisionCount,
    expectedCashTotal,
    countedCashTotal,
    cashDifferenceTotal,
    cashSessions,
    dayTenders,
    cashMovements,
  ] = await Promise.all([
    tx.cashSession.count({
      where: { operationalDayId: day.id, status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] } },
    }),
    tx.cashSession.count({
      where: { operationalDayId: day.id, status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW, requiresReview: true },
    }),
    tx.dispatchTicket.count({
      where: {
        branchId: day.branchId,
        status: { in: [...ACTIVE_DISPATCH_STATUSES] },
        createdAt: { gte: start, lt: end },
      },
    }),
    tx.brainDecision.count({
      where: {
        branchId: day.branchId,
        status: { in: ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"] },
        severity: { in: [BrainDecisionSeverity.CRITICAL, BrainDecisionSeverity.HIGH] },
        createdAt: { gte: start, lt: end },
      },
    }),
    tx.cashSession.aggregate({ where: { operationalDayId: day.id }, _sum: { expectedCashAmount: true } }),
    tx.cashSession.aggregate({ where: { operationalDayId: day.id, requiresReview: false }, _sum: { countedCashAmount: true } }),
    tx.cashSession.aggregate({ where: { operationalDayId: day.id, requiresReview: false }, _sum: { differenceAmount: true } }),
    tx.cashSession.findMany({
      where: { operationalDayId: day.id },
      include: {
        physicalCashBox: { select: { id: true, code: true, description: true } },
        openedBy: { select: { id: true, username: true, fullName: true } },
        closedBy: { select: { id: true, username: true, fullName: true } },
        reviewedBy: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { openedAt: "asc" },
    }),
    tx.paymentTender.findMany({
      where: {
        payment: {
          status: PaymentStatus.POSTED,
          paidAt: { gte: start, lt: end },
          saleOrder: { branchId: day.branchId, status: { not: SaleOrderStatus.CANCELLED } },
        },
      },
      select: { method: true, amount: true, changeAmount: true },
    }),
    tx.cashMovement.findMany({
      where: { cashSession: { operationalDayId: day.id } },
      select: { type: true, amount: true },
    }),
  ]);

  const openingCashTotal = cashSessions.reduce((sum, session) => sum + n(session.openingAmount), 0);
  const cashTenderNetTotal = dayTenders
    .filter((tender) => tender.method === PaymentMethod.CASH)
    .reduce((sum, tender) => sum + n(tender.amount) - n(tender.changeAmount), 0);
  const cardTenderTotal = dayTenders
    .filter((tender) => tender.method === PaymentMethod.CARD)
    .reduce((sum, tender) => sum + n(tender.amount), 0);
  const transferTenderTotal = dayTenders
    .filter((tender) => tender.method === PaymentMethod.TRANSFER)
    .reduce((sum, tender) => sum + n(tender.amount), 0);
  const otherTenderTotal = dayTenders
    .filter((tender) => tender.method !== PaymentMethod.CASH && tender.method !== PaymentMethod.CARD && tender.method !== PaymentMethod.TRANSFER)
    .reduce((sum, tender) => sum + n(tender.amount), 0);
  const cashMovementsNet = cashMovements.reduce((sum, movement) => sum + movementSignedAmount(movement.type, n(movement.amount)), 0);
  // Break the net movements into gross inflows / outflows so the Master can see
  // exactly how much was spent or taken out of the box ("gasto de caja").
  const cashExpensesTotal = cashMovements
    .filter((movement) => movement.type === CashMovementType.EXPENSE_OUT)
    .reduce((sum, movement) => sum + n(movement.amount), 0);
  const cashOutflowsTotal = cashMovements
    .filter((movement) => isCashOutflow(movement.type))
    .reduce((sum, movement) => sum + n(movement.amount), 0);
  const cashInflowsTotal = cashMovements
    .filter((movement) => !isCashOutflow(movement.type))
    .reduce((sum, movement) => sum + n(movement.amount), 0);
  const expectedCashOnHand = openingCashTotal + cashTenderNetTotal + cashMovementsNet;

  return {
    window: { start, end, timezone: TIMEZONE },
    salesTotal: salesSummary.paidSalesTotal,
    paidOrdersTotal: salesSummary.paidSalesTotal,
    paidSalesTotal: salesSummary.paidSalesTotal,
    paidSalesCount: salesSummary.paidSalesCount,
    pendingPaymentTotal: salesSummary.pendingPaymentTotal,
    pendingPaymentCount: salesSummary.pendingPaymentCount,
    cancelledSalesTotal: salesSummary.cancelledSalesTotal,
    cancelledSalesCount: salesSummary.cancelledSalesCount,
    postedPaymentsCount: salesSummary.postedPaymentsCount,
    voidedPaymentsCount: salesSummary.voidedPaymentsCount,
    expectedCashTotal: n(expectedCashTotal._sum.expectedCashAmount),
    countedCashTotal: n(countedCashTotal._sum.countedCashAmount),
    cashDifferenceTotal: n(cashDifferenceTotal._sum.differenceAmount),
    openingCashTotal,
    cashTenderNetTotal,
    cashMovementsNet,
    cashExpensesTotal,
    cashOutflowsTotal,
    cashInflowsTotal,
    expectedCashOnHand,
    cashNetWithoutOpening: expectedCashOnHand - openingCashTotal,
    cardTenderTotal,
    transferTenderTotal,
    otherTenderTotal,
    openCashSessionsCount,
    autoClosedPendingReviewCount,
    pendingDispatchCount,
      criticalBrainDecisionCount,
      paymentsByMethod: salesSummary.paymentsByMethod,
    cashSessions: cashSessions.map((session) => ({
      id: session.id,
      status: session.status,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      autoClosedAt: session.autoClosedAt,
      openingAmount: n(session.openingAmount),
      expectedCashAmount: n(session.expectedCashAmount),
      countedCashAmount: n(session.countedCashAmount),
      differenceAmount: n(session.differenceAmount),
      requiresReview: session.requiresReview,
      autoClosedBySystem: session.autoClosedBySystem,
      physicalCashBox: session.physicalCashBox,
      openedBy: session.openedBy,
      closedBy: session.closedBy,
      reviewedBy: session.reviewedBy,
    })),
  };
}

export async function refreshOperationalDaySummaryTx(tx: Prisma.TransactionClient, operationalDayId?: string | null) {
  if (!operationalDayId) return null;
  const day = await tx.operationalDay.findUnique({ where: { id: operationalDayId } });
  if (!day) return null;
  const summary = await calculateOperationalSummaryTx(tx, day);
  return tx.operationalDay.update({
    where: { id: day.id },
    data: {
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
      summaryJson: toJsonValue(summary),
    },
  });
}

export async function getOpenOperationalDayForBranchTx(tx: Prisma.TransactionClient, branchId: string) {
  return tx.operationalDay.findFirst({
    where: { branchId, status: OperationalDayStatus.OPEN },
    orderBy: { openedAt: "desc" },
  });
}

export async function ensureOpenOperationalDayTx(
  tx: Prisma.TransactionClient,
  branchId: string,
  openedByUserId?: string,
) {
  // Lock the branch row first to serialize concurrent cash-session opens that
  // would otherwise race to auto-create the operational day and hit the
  // @@unique([branchId, businessDate]) constraint.
  await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${branchId} FOR UPDATE`;

  const day = await getOpenOperationalDayForBranchTx(tx, branchId);
  if (day) {
    // Guard: reject if the open day belongs to a past businessDate.
    // Tying new sessions to yesterday's (or older) operational day would make
    // them invisible in the Command Center and corrupt the daily close flow.
    const todayBusinessDate = businessDateFromNow();
    if (day.businessDate.getTime() !== todayBusinessDate.getTime()) {
      throw new Error("STALE_OPERATIONAL_DAY_OPEN");
    }
    return day;
  }

  // Auto-open the operational day as a side-effect of the first cash session
  // opening. No elevated-role check is needed here — the cash session open
  // route already enforces RBAC; this is purely a bookkeeping side-effect.
  if (!openedByUserId) throw new Error("OPERATIONAL_DAY_NOT_OPEN");

  const autoDaySetting = await tx.systemSetting.findUnique({
    where: { key: OPERATIONAL_DAY_AUTO_SETTING_KEY },
    select: { value: true },
  });
  let autoDayConfig = normalizeOperationalDayAutoConfig(null);
  if (autoDaySetting) {
    try {
      autoDayConfig = normalizeOperationalDayAutoConfig(JSON.parse(autoDaySetting.value));
    } catch {
      autoDayConfig = normalizeOperationalDayAutoConfig(null);
    }
  }
  if (!autoDayConfig.autoOpenEnabled) {
    throw new Error("OPERATIONAL_DAY_NOT_OPEN");
  }

  const branch = await tx.branch.findUnique({ where: { id: branchId } });
  if (!branch?.isActive) throw new Error("BRANCH_NOT_ACTIVE");

  const businessDate = businessDateFromNow();

  // Guard: if a day already exists for today's businessDate but is not OPEN
  // (e.g. CLOSED, CLOSING, CANCELLED), attempting create would hit the
  // @@unique([branchId, businessDate]) constraint with a P2002.
  // Surface a meaningful error instead.
  const existingDay = await tx.operationalDay.findUnique({
    where: { branchId_businessDate: { branchId, businessDate } },
    select: { id: true, status: true },
  });
  if (existingDay) {
    // Should not happen — getOpenOperationalDayForBranchTx above would have
    // returned it if OPEN. At this point it must be non-OPEN.
    throw new Error("OPERATIONAL_DAY_ALREADY_CLOSED");
  }

  const created = await tx.operationalDay.create({
    data: {
      branchId,
      businessDate,
      openedByUserId,
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: openedByUserId,
      branchId,
      module: "operations",
      action: "OPERATIONAL_DAY_AUTO_OPENED",
      entityType: "OperationalDay",
      entityId: created.id,
      metadataJson: {
        branchId,
        businessDate,
        trigger: "CASH_SESSION_OPEN",
        timezone: TIMEZONE,
      },
    },
  });

  return created;
}

function buildChecklist(summary: Awaited<ReturnType<typeof calculateOperationalSummaryTx>>, dayStatus: OperationalDayStatus): OperationalDayClosePreview {
  const items: ChecklistItem[] = [
    {
      key: "day_status",
      label: "Dia operativo abierto",
      status: dayStatus === OperationalDayStatus.OPEN || dayStatus === OperationalDayStatus.CLOSING ? "OK" : "BLOCKING",
      message: dayStatus === OperationalDayStatus.OPEN ? undefined : `Estado actual: ${dayStatus}`,
    },
    {
      key: "open_cash_sessions",
      label: "No hay cajas abiertas o en conciliacion",
      status: summary.openCashSessionsCount > 0 ? "BLOCKING" : "OK",
      count: summary.openCashSessionsCount,
    },
    {
      key: "auto_closed_pending_review",
      label: "No hay cierres automaticos pendientes",
      status: summary.autoClosedPendingReviewCount > 0 ? "BLOCKING" : "OK",
      count: summary.autoClosedPendingReviewCount,
    },
    {
      key: "pending_payments",
      label: "Pagos pendientes revisados",
      status: summary.pendingPaymentTotal > 0 ? "BLOCKING" : "OK",
      message: summary.pendingPaymentTotal > 0 ? `Pendiente: C$ ${summary.pendingPaymentTotal.toFixed(2)}` : undefined,
    },
    {
      key: "pending_dispatch",
      label: "Despachos pendientes revisados",
      status: summary.pendingDispatchCount > 0 ? "WARNING" : "OK",
      count: summary.pendingDispatchCount,
    },
    {
      key: "critical_brain",
      label: "Brain critico revisado",
      status: summary.criticalBrainDecisionCount > 0 ? "WARNING" : "OK",
      count: summary.criticalBrainDecisionCount,
    },
    {
      key: "cash_difference",
      label: "Diferencias de caja justificadas",
      status: Math.abs(summary.cashDifferenceTotal) > 100 ? "WARNING" : "OK",
      message: `Diferencia acumulada: C$ ${summary.cashDifferenceTotal.toFixed(2)}`,
    },
  ];
  const blockers = items.filter((item) => item.status === "BLOCKING");
  const warnings = items.filter((item) => item.status === "WARNING");
  return {
    canClose: blockers.length === 0,
    blockers,
    warnings,
    ok: items.filter((item) => item.status === "OK"),
    summary: summary as unknown as Record<string, unknown>,
    status: dayStatus,
  };
}

export async function getCurrentOperationalDay(branchId: string) {
  const today = businessDateFromNow();
  const day = await prisma.operationalDay.findUnique({
    where: { branchId_businessDate: { branchId, businessDate: today } },
    include: { branch: true, openedBy: { select: { id: true, username: true, fullName: true } } },
  });
  if (!day) return null;
  // Only refresh live summary for OPEN days; finalized days have a stored snapshot
  if (day.status === OperationalDayStatus.OPEN) {
    await prisma.$transaction((tx) => refreshOperationalDaySummaryTx(tx, day.id));
  }
  return prisma.operationalDay.findUnique({
    where: { id: day.id },
    include: {
      branch: true,
      openedBy: { select: { id: true, username: true, fullName: true } },
      closedBy: { select: { id: true, username: true, fullName: true } },
      cashSessions: {
        include: {
          physicalCashBox: true,
          openedBy: { select: { id: true, username: true, fullName: true } },
          reviewedBy: { select: { id: true, username: true, fullName: true } },
        },
        orderBy: { openedAt: "asc" },
      },
    },
  });
}

export async function openOperationalDay(input: { branchId: string; businessDate?: string; notes?: string | null; actorUserId: string }) {
  return prisma.$transaction(async (tx) => {
    // Lock the branch row to serialize concurrent opens that would otherwise
    // race to create the operational day and hit @@unique([branchId, businessDate]).
    await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${input.branchId} FOR UPDATE`;

    const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
    if (!branch?.isActive) throw new Error("BRANCH_NOT_ACTIVE");

    const businessDate = businessDateFromInput(input.businessDate);

    // Guard 1 — Stale OPEN day from a *previous* businessDate.
    // getOpenOperationalDayForBranchTx matches any OPEN day regardless of date,
    // so a leftover day from yesterday silently blocked opening today's day with
    // a misleading "ya existe un dia abierto". Distinguish the two cases:
    //  - same businessDate that is OPEN → genuinely already open today.
    //  - different (older) businessDate that is OPEN → stale; needs Master cleanup.
    const openDay = await getOpenOperationalDayForBranchTx(tx, input.branchId);
    if (openDay) {
      if (openDay.businessDate.getTime() === businessDate.getTime()) {
        throw new Error("OPERATIONAL_DAY_ALREADY_OPEN");
      }
      throw new Error("STALE_OPERATIONAL_DAY_OPEN");
    }

    // Guard 2 — A day already exists for this businessDate but is NOT open
    // (CLOSED / CLOSING / CANCELLED). Creating it again would violate the
    // @@unique([branchId, businessDate]) constraint and surface an opaque P2002.
    // Return a clear, actionable error instead: the day was already closed and a
    // Master must reopen it to continue operating.
    const existingDay = await tx.operationalDay.findUnique({
      where: { branchId_businessDate: { branchId: input.branchId, businessDate } },
      select: { id: true, status: true },
    });
    if (existingDay) throw new Error("OPERATIONAL_DAY_ALREADY_CLOSED");

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

export async function closePreviewOperationalDay(id: string, actorUserId?: string | null) {
  return prisma.$transaction(async (tx) => {
    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id } });
    const summary = await calculateOperationalSummaryTx(tx, day);
    const preview = buildChecklist(summary, day.status);
    await tx.operationalDay.update({
      where: { id },
      data: {
        closeChecklistJson: toJsonValue(preview),
        summaryJson: toJsonValue(summary),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actorUserId ?? null,
        branchId: day.branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_CLOSE_PREVIEWED",
        entityType: "OperationalDay",
        entityId: id,
        metadataJson: toJsonValue(preview),
      },
    });
    return preview;
  });
}

export async function closeOperationalDay(input: {
  id: string;
  actorUserId: string;
  note?: string | null;
  forceClose?: boolean;
  isMaster?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });
    const summary = await calculateOperationalSummaryTx(tx, day);
    const preview = buildChecklist(summary, day.status);
    const hasWarnings = preview.warnings.length > 0;
    const hardBlockers = preview.blockers.filter((item) => isHardOperationalDayCloseBlocker(item.key));
    if (hardBlockers.length > 0) {
      throw new Error("OPERATIONAL_DAY_HAS_HARD_BLOCKERS");
    }
    if (preview.blockers.length > 0 && !(input.forceClose && input.isMaster)) {
      throw new Error("OPERATIONAL_DAY_HAS_BLOCKERS");
    }
    if ((hasWarnings || input.forceClose) && !input.note?.trim()) {
      throw new Error("OPERATIONAL_DAY_CLOSE_NOTE_REQUIRED");
    }

    const closed = await tx.operationalDay.update({
      where: { id: input.id },
      data: {
        status: OperationalDayStatus.CLOSED,
        closedByUserId: input.actorUserId,
        closedAt: new Date(),
        notes: input.note ?? day.notes,
        closeChecklistJson: toJsonValue(preview),
        summaryJson: toJsonValue(summary),
        // Immutable close snapshot — never overwritten after this point.
        closeSummaryJson: toJsonValue(summary),
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
        branchId: day.branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_CLOSED",
        entityType: "OperationalDay",
        entityId: day.id,
        metadataJson: toJsonValue({
          note: input.note ?? null,
          forceClose: Boolean(input.forceClose),
          checklist: preview,
          summary,
        }),
      },
    });

    if (preview.warnings.length > 0 || Math.abs(summary.cashDifferenceTotal) > 100) {
      await tx.brainDecision.upsert({
        where: { fingerprint: `operations:closed-with-warnings:${day.id}` },
        create: {
          category: BrainDecisionCategory.SYSTEM,
          severity: preview.blockers.length > 0 ? BrainDecisionSeverity.HIGH : BrainDecisionSeverity.MEDIUM,
          status: "OPEN",
          title: "Dia operativo cerrado con advertencias",
          description: "El dia operativo se cerro con pendientes o diferencias que requieren seguimiento.",
          recommendation: "Revisar checklist, auditoria y resolver decisiones asociadas.",
          branchId: day.branchId,
          confidenceScore: decimal(100),
          riskScore: decimal(70),
          priorityScore: decimal(70),
          proposedActionType: "REVIEW_OPERATIONAL_DAY",
          evidenceJson: toJsonValue({ operationalDayId: day.id, checklist: preview, summary }),
          fingerprint: `operations:closed-with-warnings:${day.id}`,
          idempotencyKey: `brain:operations:closed-with-warnings:${day.id}`,
        },
        update: { status: "OPEN", evidenceJson: toJsonValue({ operationalDayId: day.id, checklist: preview, summary }) },
      });
    }

    return closed;
  });
}

export type OperationalDayBlocker = {
  code: string;
  label: string;
  count: number;
  references: Array<{
    id: string;
    ref?: string;
    status?: string;
    date?: string;
    resolve?: { kind: string; href: string; entityId: string };
  }>;
};

/**
 * Computes the approval blockers (and credit-receivable warnings) for a closed
 * operational day. Runs the five blocker queries in parallel and classifies the
 * PENDING_PAYMENT orders into cash (hard blocker) vs. legitimate credit (warning).
 *
 * Returns `{ blockers, warnings }`:
 *  - `blockers` gates approval (hard blockers can never be forced; soft ones may
 *    be forced by a MASTER with a written note).
 *  - `warnings` are informative only and never block approval.
 */
export async function computeApprovalBlockers(
  tx: Prisma.TransactionClient,
  day: { id: string; branchId: string; businessDate: Date },
): Promise<{ blockers: OperationalDayBlocker[]; warnings: OperationalDayBlocker[] }> {
  // Devoluciones/anulaciones acotadas al día operativo (operationalDayId = day.id).
  // Las que no tienen operationalDayId son de días anteriores y no bloquean este cierre.
  // Transportes y pagos pendientes se acotan por rango de fecha del día de negocio.
  const { start, end } = operationalWindow(day.businessDate);

  const [
    pendingReturnRefs,
    pendingCancellationRefs,
    pendingTransportRefs,
    openOrUnreviewedSessionRefs,
    pendingPaymentOrders,
  ] = await Promise.all([
    tx.saleReturn.findMany({
      where: { operationalDayId: day.id, status: { in: ["REQUESTED", "APPROVED"] } },
      select: { id: true, returnNumber: true, status: true, createdAt: true },
      take: 20,
    }),
    tx.saleCancellation.findMany({
      where: { operationalDayId: day.id, status: { in: ["REQUESTED", "APPROVED"] } },
      select: { id: true, saleOrderId: true, status: true, createdAt: true },
      take: 20,
    }),
    tx.transportService.findMany({
      where: {
        branchId: day.branchId,
        status: { in: ["PENDING", "IN_TRANSIT"] },
        createdAt: { gte: start, lt: end },
      },
      select: { id: true, status: true, createdAt: true },
      take: 20,
    }),
    tx.cashSession.findMany({
      where: {
        operationalDayId: day.id,
        OR: [
          { status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] } },
          { status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW, requiresReview: true },
        ],
      },
      select: { id: true, status: true, openedAt: true, physicalCashBox: { select: { code: true } } },
      take: 20,
    }),
    tx.saleOrder.findMany({
      where: {
        branchId: day.branchId,
        status: SaleOrderStatus.PENDING_PAYMENT,
        createdAt: { gte: start, lt: end },
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        createdAt: true,
        customerId: true,
        customer: {
          select: {
            creditProfiles: {
              where: { isActive: true },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
      take: 40,
    }),
  ]);

  // Crédito legítimo: una orden PENDING_PAYMENT cuyo cliente tiene un perfil de
  // crédito activo (CustomerCreditProfile.isActive=true) es una cuenta por cobrar
  // a crédito y NO bloquea la aprobación. Las demás son ventas de contado sin cobrar.
  const cashPending = pendingPaymentOrders.filter((o) => !o.customer?.creditProfiles?.length);
  const creditPending = pendingPaymentOrders.filter((o) => (o.customer?.creditProfiles?.length ?? 0) > 0);

  const blockers: OperationalDayBlocker[] = [];
  const warnings: OperationalDayBlocker[] = [];

  if (pendingReturnRefs.length > 0) {
    blockers.push({
      code: "PENDING_SALE_RETURN",
      label: "Hay devoluciones pendientes de ejecutar en este día",
      count: pendingReturnRefs.length,
      references: pendingReturnRefs.map((r) => ({
        id: r.id,
        ref: r.returnNumber,
        status: r.status,
        date: r.createdAt.toISOString(),
        resolve: { kind: "SALE_RETURN", href: "/app/master/sales/orders", entityId: r.id },
      })),
    });
  }
  if (pendingCancellationRefs.length > 0) {
    blockers.push({
      code: "PENDING_SALE_CANCELLATION",
      label: "Hay anulaciones pendientes de ejecutar en este día",
      count: pendingCancellationRefs.length,
      references: pendingCancellationRefs.map((r) => ({
        id: r.id,
        ref: r.saleOrderId,
        status: r.status,
        date: r.createdAt.toISOString(),
        resolve: { kind: "SALE_CANCELLATION", href: "/app/master/sales/orders", entityId: r.saleOrderId },
      })),
    });
  }
  if (pendingTransportRefs.length > 0) {
    blockers.push({
      code: "PENDING_TRANSPORT",
      label: "Hay transportes del día pendientes o en tránsito",
      count: pendingTransportRefs.length,
      references: pendingTransportRefs.map((r) => ({
        id: r.id,
        status: r.status,
        date: r.createdAt.toISOString(),
        resolve: { kind: "TRANSPORT", href: "/app/branch/dispatch", entityId: r.id },
      })),
    });
  }
  if (openOrUnreviewedSessionRefs.length > 0) {
    blockers.push({
      code: "OPEN_OR_UNREVIEWED_CASH_SESSION",
      label: "Hay cajas abiertas o pendientes de revisión en este día",
      count: openOrUnreviewedSessionRefs.length,
      references: openOrUnreviewedSessionRefs.map((r) => ({
        id: r.id,
        ref: r.physicalCashBox?.code,
        status: r.status,
        date: r.openedAt.toISOString(),
        resolve: { kind: "CASH_SESSION", href: "/app/branch/cashier", entityId: r.id },
      })),
    });
  }
  if (cashPending.length > 0) {
    blockers.push({
      code: "PENDING_PAYMENT_ORDER",
      label: "Hay órdenes del día sin cobrar (PENDING_PAYMENT)",
      count: cashPending.length,
      references: cashPending.map((r) => ({
        id: r.id,
        ref: r.orderNumber,
        status: r.status,
        date: r.createdAt.toISOString(),
        resolve: { kind: "SALE_ORDER", href: "/app/master/sales/orders", entityId: r.id },
      })),
    });
  }
  if (creditPending.length > 0) {
    warnings.push({
      code: "OPEN_CREDIT_RECEIVABLE",
      label: "Hay ventas a crédito pendientes de pago (no bloquean la aprobación)",
      count: creditPending.length,
      references: creditPending.map((r) => ({
        id: r.id,
        ref: r.orderNumber,
        status: r.status,
        date: r.createdAt.toISOString(),
        resolve: { kind: "SALE_ORDER", href: "/app/master/sales/orders", entityId: r.id },
      })),
    });
  }

  return { blockers, warnings };
}

function throwBlockersError(
  blockers: OperationalDayBlocker[],
  warnings: OperationalDayBlocker[],
): never {
  const err = new Error("OPERATIONAL_DAY_REVIEW_HAS_BLOCKERS");
  (err as unknown as { blockers: OperationalDayBlocker[]; warnings: OperationalDayBlocker[] }).blockers = blockers;
  (err as unknown as { blockers: OperationalDayBlocker[]; warnings: OperationalDayBlocker[] }).warnings = warnings;
  throw err;
}

async function logBlockedAttempt(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  day: { id: string; branchId: string },
  blockers: OperationalDayBlocker[],
  warnings: OperationalDayBlocker[],
) {
  await tx.auditLog.create({
    data: {
      actorUserId,
      branchId: day.branchId,
      module: "operations",
      action: "OPERATIONAL_DAY_REVIEW_BLOCKED",
      entityType: "OperationalDay",
      entityId: day.id,
      metadataJson: toJsonValue({ blockers, warnings }),
    },
  });
}

export async function approveOperationalDayReview(input: {
  id: string;
  actorUserId: string;
  forceApprove?: boolean;
  note?: string | null;
  isMaster?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    // Lock the row to prevent concurrent duplicate approvals
    await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${input.id} FOR UPDATE`;

    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });

    // Idempotency guard: if already approved, return success without re-running
    if (day.approvedAt) return day;

    if (day.status !== OperationalDayStatus.CLOSED) throw new Error("OPERATIONAL_DAY_NOT_CLOSED");

    const summary = await calculateOperationalSummaryTx(tx, day);

    const { blockers: blockerList, warnings: warningList } = await computeApprovalBlockers(tx, day);

    const approveData = {
      approvedByMasterId: input.actorUserId,
      approvedAt: new Date(),
      summaryJson: toJsonValue(summary),
      // Immutable approval snapshot — captured at the moment of approval.
      approvalSummaryJson: toJsonValue(summary),
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
    };

    // Delta vs. the immutable close snapshot — recorded for the audit trail.
    const closeSummary = day.closeSummaryJson as Record<string, number> | null;
    const delta = closeSummary
      ? {
          salesTotal: n(summary.salesTotal) - (closeSummary.salesTotal ?? 0),
          cashDifferenceTotal: n(summary.cashDifferenceTotal) - (closeSummary.cashDifferenceTotal ?? 0),
        }
      : null;

    if (blockerList.length > 0) {
      const hardBlockers = blockerList.filter((b) => isHardApproveBlocker(b.code));
      const softBlockers = blockerList.filter((b) => !isHardApproveBlocker(b.code));

      // Hard blockers can never be forced.
      if (hardBlockers.length > 0) {
        await logBlockedAttempt(tx, input.actorUserId, day, blockerList, warningList);
        throwBlockersError(blockerList, warningList);
      }

      // Only soft blockers remain → permit forceApprove for a MASTER with a note.
      if (!input.forceApprove || !input.isMaster) {
        await logBlockedAttempt(tx, input.actorUserId, day, blockerList, warningList);
        throwBlockersError(blockerList, warningList);
      }
      if (!input.note?.trim()) {
        throw new Error("OPERATIONAL_DAY_APPROVE_NOTE_REQUIRED");
      }

      const approvedWithExceptions = await tx.operationalDay.update({
        where: { id: day.id },
        data: approveData,
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: day.branchId,
          module: "operations",
          action: "OPERATIONAL_DAY_APPROVED_WITH_EXCEPTIONS",
          entityType: "OperationalDay",
          entityId: day.id,
          metadataJson: toJsonValue({ note: input.note, softBlockers, warnings: warningList, summary, delta }),
        },
      });

      for (const blocker of softBlockers) {
        await tx.brainDecision.upsert({
          where: { fingerprint: `operations:approve-exception:${day.id}:${blocker.code}` },
          create: {
            category: BrainDecisionCategory.SYSTEM,
            severity: BrainDecisionSeverity.MEDIUM,
            status: "OPEN",
            title: `Excepción de aprobación: ${blocker.label}`,
            description: `Día operativo ${day.id} aprobado con excepción. Nota: ${input.note}`,
            recommendation: "Revisar el bloqueador forzado y resolver el pendiente asociado.",
            proposedActionType: "REVIEW_OPERATIONAL_DAY",
            branchId: day.branchId,
            evidenceJson: toJsonValue({ operationalDayId: day.id, blocker, note: input.note }),
            fingerprint: `operations:approve-exception:${day.id}:${blocker.code}`,
            idempotencyKey: `brain:operations:approve-exception:${day.id}:${blocker.code}`,
          },
          update: {
            status: "OPEN",
            evidenceJson: toJsonValue({ operationalDayId: day.id, blocker, note: input.note }),
          },
        });
      }

      return approvedWithExceptions;
    }

    // Normal path — no blockers.
    const approved = await tx.operationalDay.update({
      where: { id: day.id },
      data: approveData,
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: day.branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_MASTER_APPROVED",
        entityType: "OperationalDay",
        entityId: day.id,
        metadataJson: toJsonValue({ summary, delta, warnings: warningList }),
      },
    });

    return approved;
  });
}

export async function cancelOperationalDay(input: { id: string; actorUserId: string; note: string; override?: boolean }) {
  return prisma.$transaction(async (tx) => {
    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });
    const { start, end } = operationalWindow(day.businessDate);
    const realPayments = await tx.payment.count({
      where: { paidAt: { gte: start, lt: end }, saleOrder: { branchId: day.branchId } },
    });
    if (realPayments > 0 && !input.override) throw new Error("OPERATIONAL_DAY_HAS_REAL_PAYMENTS");
    const cancelled = await tx.operationalDay.update({
      where: { id: day.id },
      data: { status: OperationalDayStatus.CANCELLED, closedByUserId: input.actorUserId, closedAt: new Date(), notes: input.note },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: day.branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_CANCELLED",
        entityType: "OperationalDay",
        entityId: day.id,
        metadataJson: { note: input.note, override: Boolean(input.override), realPayments },
      },
    });
    return cancelled;
  });
}

export async function listOperationalDays(filters: {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  status?: OperationalDayStatus;
  hasIssues?: boolean;
  reviewState?: "pending" | "approved" | "all";
}) {
  const businessDate = filters.date     ? businessDateFromInput(filters.date)     : undefined;
  const dateFromVal  = filters.dateFrom ? businessDateFromInput(filters.dateFrom) : undefined;
  const dateToVal    = filters.dateTo   ? businessDateFromInput(filters.dateTo)   : undefined;

  const where: Prisma.OperationalDayWhereInput = {};

  if (businessDate) {
    where.businessDate = businessDate;
  } else if (dateFromVal || dateToVal) {
    where.businessDate = {
      ...(dateFromVal ? { gte: dateFromVal } : {}),
      ...(dateToVal   ? { lte: dateToVal   } : {}),
    };
  }

  if (filters.branchId) where.branchId = filters.branchId;

  if (filters.reviewState === "pending") {
    // Pending Master approval = the branch has CLOSED the day but it has not been
    // approved yet. OPEN/CLOSING days are still being operated (not awaiting
    // approval) and CANCELLED days are discarded, so neither belongs in the
    // "Bandeja Master — Pendientes de aprobación". Previously this only filtered
    // by approvedAt=null, which incorrectly surfaced active OPEN days.
    where.approvedAt = null;
    where.status = filters.status ?? OperationalDayStatus.CLOSED;
  } else if (filters.reviewState === "approved") {
    where.approvedAt = { not: null };
  } else if (filters.status) {
    where.status = filters.status;
  }

  if (filters.hasIssues) {
    where.OR = [
      { openCashSessionsCount: { gt: 0 } },
      { autoClosedPendingReviewCount: { gt: 0 } },
      { pendingDispatchCount: { gt: 0 } },
      { criticalBrainDecisionCount: { gt: 0 } },
    ];
  }

  return prisma.operationalDay.findMany({
    where,
    include: {
      branch: { select: { id: true, code: true, name: true } },
      openedBy: { select: { id: true, username: true, fullName: true } },
      closedBy: { select: { id: true, username: true, fullName: true } },
    },
    orderBy: [{ businessDate: "desc" }, { openedAt: "desc" }],
    take: 200,
  });
}

export async function getDailyReport(id: string) {
  const day = await prisma.operationalDay.findUniqueOrThrow({
    where: { id },
    include: {
      branch: true,
      openedBy: { select: { id: true, username: true, fullName: true } },
      closedBy: { select: { id: true, username: true, fullName: true } },
      cashSessions: { include: { physicalCashBox: true, openedBy: { select: { id: true, username: true, fullName: true } } } },
    },
  });
  const { start, end } = operationalWindow(day.businessDate);
  const [orders, paymentsByMethod, dispatches, brain, audit] = await Promise.all([
    prisma.saleOrder.findMany({
      where: { branchId: day.branchId, createdAt: { gte: start, lt: end } },
      select: { id: true, orderNumber: true, status: true, grandTotal: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.payment.groupBy({
      by: ["method"],
      where: { status: PaymentStatus.POSTED, paidAt: { gte: start, lt: end }, saleOrder: { branchId: day.branchId } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.dispatchTicket.findMany({
      where: { branchId: day.branchId, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    prisma.brainDecision.findMany({
      where: { branchId: day.branchId, createdAt: { gte: start, lt: end } },
      orderBy: { priorityScore: "desc" },
      take: 50,
    }),
    prisma.auditLog.findMany({
      where: { branchId: day.branchId, occurredAt: { gte: start, lt: end }, module: { in: ["operations", "cash_session", "payments", "dispatch"] } },
      orderBy: { occurredAt: "asc" },
      take: 200,
    }),
  ]);
  return { day, orders, paymentsByMethod, dispatches, brain, audit, window: { start, end, timezone: TIMEZONE } };
}

export async function getOperationalDayBranchId(id: string) {
  const day = await prisma.operationalDay.findUniqueOrThrow({ where: { id }, select: { branchId: true } });
  return day.branchId;
}

// ── Derived state ─────────────────────────────────────────────────────────────

export type OperationalDayDerivedState =
  | "NOT_OPENED_TODAY"
  | "OPEN_TODAY"
  | "CLOSING"
  | "CLOSED_PENDING_MASTER"
  | "APPROVED_ARCHIVED"
  | "CANCELLED"
  | "STALE_OPEN_DAY";

export function deriveOperationalDayState(
  day: { status: string; businessDate: Date; approvedAt: Date | null } | null,
): OperationalDayDerivedState {
  if (!day) return "NOT_OPENED_TODAY";
  const today = businessDateFromNow();
  if (day.status === "OPEN") {
    return day.businessDate.getTime() === today.getTime() ? "OPEN_TODAY" : "STALE_OPEN_DAY";
  }
  if (day.status === "CLOSING") return "CLOSING";
  if (day.status === "CLOSED") return day.approvedAt ? "APPROVED_ARCHIVED" : "CLOSED_PENDING_MASTER";
  if (day.status === "CANCELLED") return "CANCELLED";
  return "NOT_OPENED_TODAY";
}

// ── Live blockers (real-time, no stored-field contamination) ──────────────────

type BranchLiveStatus = {
  branchId: string;
  branchCode: string;
  branchName: string;
  businessDate: string | null;
  operationalDayId: string | null;
  operationalDayStatus: string | null;
  derivedState: OperationalDayDerivedState;
  blockers: {
    openCashSessions: number;
    reconcilingCashSessions: number;
    autoClosedPendingReview: number;
    staleOpenOperationalDays: number;
    staleCashSessions: number;
  };
  alerts: {
    pendingPaymentOrdersToday: number;
    pendingDispatchToday: number;
    criticalBrainOpen: number;
  };
  totalBlockers: number;
};

export async function getLiveBlockers(): Promise<{
  total: number;
  branches: BranchLiveStatus[];
  computedAt: string;
}> {
  const today = businessDateFromNow();
  const { start, end } = operationalWindow(today);

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  const branchResults = await Promise.all(
    branches.map(async (branch): Promise<BranchLiveStatus> => {
      const [
        todayDay,
        staleOpenDaysCount,
        openCashSessionsCount,
        reconcilingCount,
        staleCashSessionsCount,
        autoClosedPendingCount,
        pendingPaymentCount,
        pendingDispatchCount,
        criticalBrainCount,
      ] = await Promise.all([
        prisma.operationalDay.findUnique({
          where: { branchId_businessDate: { branchId: branch.id, businessDate: today } },
          select: { id: true, status: true, businessDate: true, approvedAt: true },
        }),
        // Stale OPEN day from a past date — this is a genuine stuck state.
        prisma.operationalDay.count({
          where: { branchId: branch.id, status: OperationalDayStatus.OPEN, businessDate: { not: today } },
        }),
        // OPEN cash sessions that belong to TODAY's operational day. These are a
        // normal part of an active day (the box is simply in use); they are NOT
        // "atascadas" and must not be reported as operational blockers.
        prisma.cashSession.count({
          where: {
            status: CashSessionStatus.OPEN,
            physicalCashBox: { branchId: branch.id },
            operationalDay: { businessDate: today },
          },
        }),
        // RECONCILING sessions on TODAY's day — also part of the normal close flow.
        prisma.cashSession.count({
          where: {
            status: CashSessionStatus.RECONCILING,
            physicalCashBox: { branchId: branch.id },
            operationalDay: { businessDate: today },
          },
        }),
        // Genuinely STUCK cash sessions: still OPEN/RECONCILING but tied to a
        // previous business date (or orphaned with no operational day). These are
        // the real "atascadas" that require a Master cleanup.
        prisma.cashSession.count({
          where: {
            status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] },
            physicalCashBox: { branchId: branch.id },
            OR: [
              { operationalDayId: null },
              { operationalDay: { businessDate: { not: today } } },
            ],
          },
        }),
        prisma.cashSession.count({
          where: {
            status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW,
            requiresReview: true,
            physicalCashBox: { branchId: branch.id },
          },
        }),
        prisma.saleOrder.count({
          where: { branchId: branch.id, status: SaleOrderStatus.PENDING_PAYMENT, createdAt: { gte: start, lt: end } },
        }),
        prisma.dispatchTicket.count({
          where: { branchId: branch.id, status: { in: ["PENDING", "IN_PROGRESS"] }, createdAt: { gte: start, lt: end } },
        }),
        prisma.brainDecision.count({
          where: {
            branchId: branch.id,
            status: { in: ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"] },
            severity: { in: [BrainDecisionSeverity.CRITICAL, BrainDecisionSeverity.HIGH] },
            createdAt: { gte: start, lt: end },
          },
        }),
      ]);

      const blockers = {
        openCashSessions: openCashSessionsCount,
        reconcilingCashSessions: reconcilingCount,
        autoClosedPendingReview: autoClosedPendingCount,
        staleOpenOperationalDays: staleOpenDaysCount,
        staleCashSessions: staleCashSessionsCount,
      };

      // "Bloqueos operativos" must reflect ONLY genuinely stuck states that need a
      // Master to intervene right now: stale OPEN days from previous dates and
      // cash sessions left open/reconciling on a past day. Cash sessions open on
      // today's active day and auto-closed sessions pending review are part of the
      // normal daily workflow (the latter is an expected, automatic process) and
      // must NOT be flagged as errors here.
      const totalBlockers =
        blockers.staleOpenOperationalDays +
        blockers.staleCashSessions;

      return {
        branchId: branch.id,
        branchCode: branch.code,
        branchName: branch.name,
        businessDate: todayDay?.businessDate.toISOString() ?? null,
        operationalDayId: todayDay?.id ?? null,
        operationalDayStatus: todayDay?.status ?? null,
        derivedState: deriveOperationalDayState(todayDay ?? null),
        blockers,
        alerts: {
          pendingPaymentOrdersToday: pendingPaymentCount,
          pendingDispatchToday: pendingDispatchCount,
          criticalBrainOpen: criticalBrainCount,
        },
        totalBlockers,
      };
    }),
  );

  return {
    total: branchResults.reduce((sum, b) => sum + b.totalBlockers, 0),
    branches: branchResults,
    computedAt: new Date().toISOString(),
  };
}

// ── Reopen operational day ────────────────────────────────────────────────────

export async function reopenOperationalDay(input: { id: string; actorUserId: string; note: string }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${input.id} FOR UPDATE`;

    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });

    if (day.status !== OperationalDayStatus.CLOSED) throw new Error("OPERATIONAL_DAY_NOT_CLOSED");

    // Reopening an already-approved day requires a written justification for the audit trail
    if (day.approvedAt && !input.note?.trim()) throw new Error("OPERATIONAL_DAY_REOPEN_NOTE_REQUIRED");

    const reopened = await tx.operationalDay.update({
      where: { id: input.id },
      data: {
        status: OperationalDayStatus.OPEN,
        closedAt: null,
        closedByUserId: null,
        approvedAt: null,
        approvedByMasterId: null,
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
          wasApproved: !!day.approvedAt,
          previousApprovedAt: day.approvedAt,
          previousApprovedByMasterId: day.approvedByMasterId,
        }),
      },
    });

    return reopened;
  });
}
