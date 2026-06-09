import {
  BrainDecisionCategory,
  BrainDecisionSeverity,
  CashSessionStatus,
  OperationalDayStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SaleOrderStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OperationalDayClosePreview, ChecklistItem } from "@/modules/operations/types";

const TIMEZONE = "America/Managua";
const CLOSED_ORDER_STATUSES = [SaleOrderStatus.DISPATCH_PENDING, SaleOrderStatus.DISPATCHED, SaleOrderStatus.PAID];
const ACTIVE_DISPATCH_STATUSES = ["PENDING", "IN_PROGRESS"] as const;

function decimal(value: number) {
  return new Prisma.Decimal(Number.isFinite(value) ? value : 0);
}

function n(value: Prisma.Decimal | number | string | null | undefined) {
  return Number(value ?? 0);
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

async function calculateOperationalSummaryTx(tx: Prisma.TransactionClient, day: { id: string; branchId: string; businessDate: Date }) {
  const { start, end } = operationalWindow(day.businessDate);
  const [
    salesTotal,
    paidOrdersTotal,
    pendingPaymentTotal,
    openCashSessionsCount,
    autoClosedPendingReviewCount,
    pendingDispatchCount,
    criticalBrainDecisionCount,
    expectedCashTotal,
    countedCashTotal,
    cashDifferenceTotal,
    paymentsByMethod,
    cashSessions,
  ] = await Promise.all([
    tx.saleOrder.aggregate({
      where: { branchId: day.branchId, createdAt: { gte: start, lt: end }, status: { not: SaleOrderStatus.CANCELLED } },
      _sum: { grandTotal: true },
    }),
    tx.saleOrder.aggregate({
      where: { branchId: day.branchId, createdAt: { gte: start, lt: end }, status: { in: CLOSED_ORDER_STATUSES } },
      _sum: { grandTotal: true },
    }),
    tx.saleOrder.aggregate({
      where: { branchId: day.branchId, createdAt: { gte: start, lt: end }, status: SaleOrderStatus.PENDING_PAYMENT },
      _sum: { grandTotal: true },
    }),
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
    tx.payment.groupBy({
      by: ["method"],
      where: { status: PaymentStatus.POSTED, paidAt: { gte: start, lt: end }, saleOrder: { branchId: day.branchId } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    tx.cashSession.findMany({
      where: { operationalDayId: day.id },
      include: {
        physicalCashBox: { select: { id: true, code: true, description: true } },
        openedBy: { select: { id: true, username: true, fullName: true } },
        reviewedBy: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { openedAt: "asc" },
    }),
  ]);

  return {
    window: { start, end, timezone: TIMEZONE },
    salesTotal: n(salesTotal._sum.grandTotal),
    paidOrdersTotal: n(paidOrdersTotal._sum.grandTotal),
    pendingPaymentTotal: n(pendingPaymentTotal._sum.grandTotal),
    expectedCashTotal: n(expectedCashTotal._sum.expectedCashAmount),
    countedCashTotal: n(countedCashTotal._sum.countedCashAmount),
    cashDifferenceTotal: n(cashDifferenceTotal._sum.differenceAmount),
    openCashSessionsCount,
    autoClosedPendingReviewCount,
    pendingDispatchCount,
      criticalBrainDecisionCount,
      paymentsByMethod: paymentsByMethod.map((row) => ({
      method: row.method,
      amount: n(row._sum.amount),
      count: row._count._all,
      })),
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

/**
 * Garantiza que la sucursal tenga un día operativo ABIERTO y lo devuelve.
 *
 * AUTOMATIZACIÓN: el día operativo ya NO requiere que un administrador lo abra
 * manualmente. Si no hay un día abierto, se abre automáticamente (o se reactiva
 * el día de hoy si quedó cerrado), de forma que cajeros y vendedores puedan
 * operar sin bloqueos ni intervención de un admin. El concepto se conserva
 * porque agrupa las sesiones de caja, alimenta el reporte diario y el cierre de
 * caja; solo se elimina el bloqueo manual.
 */
export async function ensureOpenOperationalDayTx(
  tx: Prisma.TransactionClient,
  branchId: string,
  actorUserId: string,
) {
  const open = await getOpenOperationalDayForBranchTx(tx, branchId);
  if (open) return open;

  const businessDate = businessDateFromNow();

  // Por la restricción única (branchId + businessDate) solo puede existir un día
  // por fecha. Si el de hoy ya existe pero está cerrado/cancelado, lo reactivamos
  // para no bloquear la operación.
  const sameDate = await tx.operationalDay.findUnique({
    where: { branchId_businessDate: { branchId, businessDate } },
  });
  if (sameDate) {
    if (sameDate.status === OperationalDayStatus.OPEN) return sameDate;
    const reopened = await tx.operationalDay.update({
      where: { id: sameDate.id },
      data: { status: OperationalDayStatus.OPEN, closedByUserId: null, closedAt: null },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_AUTO_REOPENED",
        entityType: "OperationalDay",
        entityId: reopened.id,
        metadataJson: { branchId, businessDate, auto: true, previousStatus: sameDate.status, timezone: TIMEZONE },
      },
    });
    return reopened;
  }

  try {
    const day = await tx.operationalDay.create({
      data: {
        branchId,
        businessDate,
        openedByUserId: actorUserId,
        notes: "Apertura automática del día operativo.",
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_AUTO_OPENED",
        entityType: "OperationalDay",
        entityId: day.id,
        metadataJson: { branchId, businessDate, auto: true, timezone: TIMEZONE },
      },
    });
    return day;
  } catch (error) {
    // Carrera: otra transacción creó el día al mismo tiempo. Re-leemos.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced =
        (await getOpenOperationalDayForBranchTx(tx, branchId)) ??
        (await tx.operationalDay.findUnique({
          where: { branchId_businessDate: { branchId, businessDate } },
        }));
      if (raced) return raced;
    }
    throw error;
  }
}

/**
 * Variante fuera de transacción para llamadas que no comparten un `tx`.
 */
export async function ensureOpenOperationalDay(branchId: string, actorUserId: string) {
  return prisma.$transaction((tx) => ensureOpenOperationalDayTx(tx, branchId, actorUserId));
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

export async function listOperationalDays(filters: { date?: string; branchId?: string; status?: OperationalDayStatus; hasIssues?: boolean }) {
  const businessDate = filters.date ? businessDateFromInput(filters.date) : undefined;
  return prisma.operationalDay.findMany({
    where: {
      ...(businessDate ? { businessDate } : {}),
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
    take: 100,
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
