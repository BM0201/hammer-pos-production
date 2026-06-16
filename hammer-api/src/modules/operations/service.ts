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
import { getSalesSummaryForOperationalDayTx } from "@/modules/sales/realtime-sales-summary";

export const OPERATIONAL_TIMEZONE = "America/Managua";
const TIMEZONE = OPERATIONAL_TIMEZONE;
const ACTIVE_DISPATCH_STATUSES = ["PENDING", "IN_PROGRESS"] as const;
function decimal(value: number) {
  return new Prisma.Decimal(Number.isFinite(value) ? value : 0);
}

function n(value: Prisma.Decimal | number | string | null | undefined) {
  return Number(value ?? 0);
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

async function calculateOperationalSummaryTx(tx: Prisma.TransactionClient, day: { id: string; branchId: string; businessDate: Date }) {
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
      where: { branchId: day.branchId, status: { in: [...ACTIVE_DISPATCH_STATUSES] } },
    }),
    tx.brainDecision.count({
      where: {
        branchId: day.branchId,
        status: { in: ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"] },
        severity: { in: [BrainDecisionSeverity.CRITICAL, BrainDecisionSeverity.HIGH] },
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
      physicalCashBox: session.physicalCashBox,
      openedBy: session.openedBy,
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
      throw new Error("OPERATIONAL_DAY_STALE");
    }
    return day;
  }

  // Auto-open the operational day as a side-effect of the first cash session
  // opening. No elevated-role check is needed here — the cash session open
  // route already enforces RBAC; this is purely a bookkeeping side-effect.
  if (!openedByUserId) throw new Error("OPERATIONAL_DAY_NOT_OPEN");

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
  const day = await prisma.operationalDay.findFirst({
    where: { branchId, status: OperationalDayStatus.OPEN },
    include: { branch: true, openedBy: { select: { id: true, username: true, fullName: true } } },
    orderBy: { openedAt: "desc" },
  });
  if (!day) return null;
  await prisma.$transaction((tx) => refreshOperationalDaySummaryTx(tx, day.id));
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
    const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
    if (!branch?.isActive) throw new Error("BRANCH_NOT_ACTIVE");
    const openDay = await getOpenOperationalDayForBranchTx(tx, input.branchId);
    if (openDay) throw new Error("OPERATIONAL_DAY_ALREADY_OPEN");
    const businessDate = businessDateFromInput(input.businessDate);
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
  references: Array<{ id: string; ref?: string; status?: string; date?: string }>;
};

export async function approveOperationalDayReview(input: { id: string; actorUserId: string }) {
  return prisma.$transaction(async (tx) => {
    // Lock the row to prevent concurrent duplicate approvals
    await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${input.id} FOR UPDATE`;

    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });

    // Idempotency guard: if already approved, return success without re-running
    if (day.approvedAt) return day;

    if (day.status !== OperationalDayStatus.CLOSED) throw new Error("OPERATIONAL_DAY_NOT_CLOSED");

    const summary = await calculateOperationalSummaryTx(tx, day);

    // Devoluciones/anulaciones acotadas al día operativo (operationalDayId = day.id).
    // Las que no tienen operationalDayId son de días anteriores y no bloquean este cierre.
    // Transportes y pagos pendientes se acoten por rango de fecha del día de negocio.
    const { start, end } = operationalWindow(day.businessDate);

    const [
      pendingReturnRefs,
      pendingCancellationRefs,
      pendingTransportRefs,
      openOrUnreviewedSessionRefs,
      pendingPaymentRefs,
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
        select: { id: true, orderNumber: true, status: true, createdAt: true },
        take: 20,
      }),
    ]);

    const blockerList: OperationalDayBlocker[] = [];

    if (pendingReturnRefs.length > 0) {
      blockerList.push({
        code: "PENDING_SALE_RETURN",
        label: "Hay devoluciones pendientes de ejecutar en este día",
        count: pendingReturnRefs.length,
        references: pendingReturnRefs.map((r) => ({
          id: r.id,
          ref: r.returnNumber,
          status: r.status,
          date: r.createdAt.toISOString(),
        })),
      });
    }
    if (pendingCancellationRefs.length > 0) {
      blockerList.push({
        code: "PENDING_SALE_CANCELLATION",
        label: "Hay anulaciones pendientes de ejecutar en este día",
        count: pendingCancellationRefs.length,
        references: pendingCancellationRefs.map((r) => ({
          id: r.id,
          ref: r.saleOrderId,
          status: r.status,
          date: r.createdAt.toISOString(),
        })),
      });
    }
    if (pendingTransportRefs.length > 0) {
      blockerList.push({
        code: "PENDING_TRANSPORT",
        label: "Hay transportes del día pendientes o en tránsito",
        count: pendingTransportRefs.length,
        references: pendingTransportRefs.map((r) => ({
          id: r.id,
          status: r.status,
          date: r.createdAt.toISOString(),
        })),
      });
    }
    if (openOrUnreviewedSessionRefs.length > 0) {
      blockerList.push({
        code: "OPEN_OR_UNREVIEWED_CASH_SESSION",
        label: "Hay cajas abiertas o pendientes de revisión en este día",
        count: openOrUnreviewedSessionRefs.length,
        references: openOrUnreviewedSessionRefs.map((r) => ({
          id: r.id,
          ref: r.physicalCashBox?.code,
          status: r.status,
          date: r.openedAt.toISOString(),
        })),
      });
    }
    if (pendingPaymentRefs.length > 0) {
      blockerList.push({
        code: "PENDING_PAYMENT_ORDER",
        label: "Hay órdenes del día sin cobrar (PENDING_PAYMENT)",
        count: pendingPaymentRefs.length,
        references: pendingPaymentRefs.map((r) => ({
          id: r.id,
          ref: r.orderNumber,
          status: r.status,
          date: r.createdAt.toISOString(),
        })),
      });
    }

    if (blockerList.length > 0) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: day.branchId,
          module: "operations",
          action: "OPERATIONAL_DAY_REVIEW_BLOCKED",
          entityType: "OperationalDay",
          entityId: day.id,
          metadataJson: toJsonValue({ blockers: blockerList }),
        },
      });
      const err = new Error("OPERATIONAL_DAY_REVIEW_HAS_BLOCKERS");
      (err as unknown as { blockers: OperationalDayBlocker[] }).blockers = blockerList;
      throw err;
    }

    const approved = await tx.operationalDay.update({
      where: { id: day.id },
      data: {
        approvedByMasterId: input.actorUserId,
        approvedAt: new Date(),
        summaryJson: toJsonValue(summary),
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: day.branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_MASTER_APPROVED",
        entityType: "OperationalDay",
        entityId: day.id,
        metadataJson: toJsonValue({ summary }),
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

export async function listOperationalDays(filters: { date?: string; dateFrom?: string; dateTo?: string; branchId?: string; status?: OperationalDayStatus; hasIssues?: boolean }) {
  const businessDate  = filters.date     ? businessDateFromInput(filters.date)     : undefined;
  const dateFromVal   = filters.dateFrom ? businessDateFromInput(filters.dateFrom) : undefined;
  const dateToVal     = filters.dateTo   ? businessDateFromInput(filters.dateTo)   : undefined;

  let businessDateFilter: { businessDate?: Date | { gte?: Date; lte?: Date } } = {};
  if (businessDate) {
    businessDateFilter = { businessDate };
  } else if (dateFromVal || dateToVal) {
    businessDateFilter = {
      businessDate: {
        ...(dateFromVal ? { gte: dateFromVal } : {}),
        ...(dateToVal   ? { lte: dateToVal   } : {}),
      },
    };
  }

  return prisma.operationalDay.findMany({
    where: {
      ...businessDateFilter,
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.hasIssues ? {
        OR: [
          { openCashSessionsCount: { gt: 0 } },
          { autoClosedPendingReviewCount: { gt: 0 } },
          { pendingDispatchCount: { gt: 0 } },
          { criticalBrainDecisionCount: { gt: 0 } },
        ],
      } : {}),
    },
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
