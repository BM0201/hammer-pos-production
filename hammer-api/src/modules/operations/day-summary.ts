import {
  CashMovementType,
  CashSessionStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  SaleOrderStatus,
  BrainDecisionSeverity,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ChecklistItem, OperationalDayChecklist } from "@/modules/operations/types";
import { getSalesSummaryForOperationalDayTx } from "@/modules/sales/realtime-sales-summary";
import {
  cashMovementsNetTotalDecimal,
  cashTenderTotalDecimal,
  computeExpectedCashDecimal,
  isCashOutflowType,
  tenderTotalsByMethodDecimal,
} from "@/modules/cash-session/expected-cash";
import { OPERATIONAL_TIMEZONE, businessDateFromNow, operationalWindow } from "@/modules/operations/business-date";
import { getCashToleranceConfig, resolveCashToleranceForBranch } from "@/modules/operations/cash-tolerance-config";

const TIMEZONE = OPERATIONAL_TIMEZONE;

function d(value: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal {
  return new Prisma.Decimal(value ?? 0);
}

function n(value: Prisma.Decimal | number | string | null | undefined) {
  return Number(value ?? 0);
}

function decimal(value: number) {
  return new Prisma.Decimal(Number.isFinite(value) ? value : 0);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Cálculo del snapshot del día — sin cambios de lógica respecto al modelo
 * anterior (Día Operativo v2). `sweptAt` reemplaza a `closedAt` como marca de
 * "el día dejó de ser el activo": una venta offline sincronizada DESPUÉS de
 * ese momento es tardía, sin importar si el día ya fue confirmado por Master.
 */
export async function calculateOperationalSummaryTx(
  tx: Prisma.TransactionClient,
  day: { id: string; branchId: string; businessDate: Date; sweptAt?: Date | null },
) {
  const { start, end } = operationalWindow(day.businessDate);

  const salesSummary = await getSalesSummaryForOperationalDayTx(tx, day.id);

  const [
    openCashSessionsCount,
    autoClosedPendingReviewCount,
    pendingDispatchCount,
    criticalBrainDecisionCount,
    expectedCashTotal,
    expectedCashPendingReviewTotal,
    countedCashTotal,
    cashDifferenceTotal,
    cashSessions,
    dayTenders,
    cashMovements,
  ] = await Promise.all([
    tx.cashSession.count({ where: { operationalDayId: day.id, status: CashSessionStatus.OPEN } }),
    tx.cashSession.count({ where: { operationalDayId: day.id, status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW, requiresReview: true } }),
    tx.dispatchTicket.count({ where: { branchId: day.branchId, status: { in: ["PENDING", "IN_PROGRESS"] }, createdAt: { gte: start, lt: end } } }),
    tx.brainDecision.count({
      where: {
        branchId: day.branchId,
        status: { in: ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"] },
        severity: { in: [BrainDecisionSeverity.CRITICAL, BrainDecisionSeverity.HIGH] },
        createdAt: { gte: start, lt: end },
      },
    }),
    tx.cashSession.aggregate({ where: { operationalDayId: day.id, status: { not: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW } }, _sum: { expectedCashAmount: true } }),
    tx.cashSession.aggregate({ where: { operationalDayId: day.id, status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW }, _sum: { expectedCashAmount: true } }),
    tx.cashSession.aggregate({ where: { operationalDayId: day.id }, _sum: { countedCashAmount: true } }),
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
    // Fase 2: complemento exacto y mutuamente excluyente de dayTendersById
    // (uno exige operationalDayId === day.id, el otro operationalDayId === null).
    tx.paymentTender.findMany({
      where: {
        operationalDayId: null,
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

  const [dayTendersById, salesIdCount, salesWindowCount, paymentsIdCount, paymentsWindowCount] = await Promise.all([
    tx.paymentTender.findMany({
      where: {
        operationalDayId: day.id,
        payment: { status: PaymentStatus.POSTED, saleOrder: { status: { not: SaleOrderStatus.CANCELLED } } },
      },
      select: { method: true, amount: true, changeAmount: true },
    }),
    tx.saleOrder.count({ where: { operationalDayId: day.id } }),
    tx.saleOrder.count({ where: { branchId: day.branchId, createdAt: { gte: start, lt: end } } }),
    tx.payment.count({ where: { operationalDayId: day.id, status: PaymentStatus.POSTED } }),
    tx.payment.count({ where: { status: PaymentStatus.POSTED, paidAt: { gte: start, lt: end }, saleOrder: { branchId: day.branchId } } }),
  ]);

  const effectiveTenders = [...dayTendersById, ...dayTenders];
  const sourceMode: "OPERATIONAL_DAY_ID" | "MIXED" | "LEGACY_TIME_WINDOW" =
    paymentsIdCount > 0
      ? paymentsIdCount < paymentsWindowCount
        ? "MIXED"
        : "OPERATIONAL_DAY_ID"
      : "LEGACY_TIME_WINDOW";
  const legacyFallbackCounts = {
    salesById: salesIdCount,
    salesByWindow: salesWindowCount,
    paymentsById: paymentsIdCount,
    paymentsByWindow: paymentsWindowCount,
  };
  const summaryWarnings: string[] = [];
  if (sourceMode === "LEGACY_TIME_WINDOW" && paymentsWindowCount > 0) {
    summaryWarnings.push("LEGACY_TIME_WINDOW: pagos sin operationalDayId; totales por ventana horaria (legacy).");
  }
  if (sourceMode === "MIXED") {
    summaryWarnings.push(`MIXED: ${paymentsIdCount}/${paymentsWindowCount} pagos con operationalDayId; el resto por ventana.`);
  }

  const totalsByPaymentMethodDecimal = tenderTotalsByMethodDecimal(effectiveTenders);
  const totalsByPaymentMethod = Object.fromEntries(
    Object.entries(totalsByPaymentMethodDecimal).map(([method, totals]) => [
      method,
      { amount: totals.amount.toNumber(), changeAmount: totals.changeAmount.toNumber(), net: totals.net.toNumber() },
    ]),
  );

  const openingCashTotalDecimal = cashSessions.reduce((sum, session) => sum.add(session.openingAmount), d(0));
  const cashTenderNetTotalDecimal = cashTenderTotalDecimal(effectiveTenders);
  const cardTenderTotalDecimal = effectiveTenders
    .filter((tender) => tender.method === PaymentMethod.CARD)
    .reduce((sum, tender) => sum.add(tender.amount), d(0));
  const transferTenderTotalDecimal = effectiveTenders
    .filter((tender) => tender.method === PaymentMethod.TRANSFER)
    .reduce((sum, tender) => sum.add(tender.amount), d(0));
  const otherTenderTotalDecimal = effectiveTenders
    .filter((tender) => tender.method !== PaymentMethod.CASH && tender.method !== PaymentMethod.CARD && tender.method !== PaymentMethod.TRANSFER)
    .reduce((sum, tender) => sum.add(tender.amount), d(0));
  const cashMovementsNetDecimal = cashMovementsNetTotalDecimal(cashMovements);
  const cashExpensesTotalDecimal = cashMovements
    .filter((movement) => movement.type === CashMovementType.EXPENSE_OUT)
    .reduce((sum, movement) => sum.add(movement.amount), d(0));
  const cashOutflowsTotalDecimal = cashMovements
    .filter((movement) => isCashOutflowType(movement.type))
    .reduce((sum, movement) => sum.add(movement.amount), d(0));
  const cashInflowsTotalDecimal = cashMovements
    .filter((movement) => !isCashOutflowType(movement.type))
    .reduce((sum, movement) => sum.add(movement.amount), d(0));
  const expectedCashOnHandDecimal = computeExpectedCashDecimal({
    openingAmount: openingCashTotalDecimal,
    postedCashPayments: cashTenderNetTotalDecimal,
    cashMovementsNet: cashMovementsNetDecimal,
  });

  const changeAmountTotalDecimal = effectiveTenders.reduce((sum, tender) => sum.add(tender.changeAmount ?? 0), d(0));

  const refunds = await tx.refund.findMany({
    where: {
      OR: [
        { operationalDayId: day.id },
        { operationalDayId: null, cashSession: { operationalDayId: day.id } },
      ],
    },
    select: { method: true, amount: true, status: true },
  });
  const refundsByMethodDecimal = refunds.reduce<Record<string, Prisma.Decimal>>((acc, r) => {
    acc[r.method] = (acc[r.method] ?? d(0)).add(r.amount);
    return acc;
  }, {});
  const refundsSummary = {
    total: refunds.reduce((sum, r) => sum.add(r.amount), d(0)).toNumber(),
    count: refunds.length,
    byMethod: Object.fromEntries(Object.entries(refundsByMethodDecimal).map(([method, total]) => [method, total.toNumber()])),
  };

  const cashMovementsSummary = {
    net: cashMovementsNetDecimal.toNumber(),
    inflows: cashInflowsTotalDecimal.toNumber(),
    outflows: cashOutflowsTotalDecimal.toNumber(),
    expenses: cashExpensesTotalDecimal.toNumber(),
  };

  // Ventas offline sincronizadas DESPUÉS de que el día dejó de ser el activo
  // (sweptAt) = pendientes de revisión. Mientras el día sigue ACTIVE, sweptAt
  // es null y esto siempre es 0 (sincronizar contra el día en curso es normal).
  const lateOfflineSyncCount = day.sweptAt
    ? await tx.saleOrder.count({
        where: { operationalDayId: day.id, offlineClientId: { not: null }, syncedAt: { gt: day.sweptAt } },
      })
    : 0;

  const expectedVsCountedByCashSession = cashSessions.map((session) => ({
    cashSessionId: session.id,
    physicalCashBoxCode: session.physicalCashBox?.code ?? null,
    status: session.status,
    expected: n(session.expectedCashAmount),
    counted: n(session.countedCashAmount),
    difference: n(session.differenceAmount),
    requiresReview: session.requiresReview,
  }));

  return {
    window: { start, end, timezone: TIMEZONE },
    sourceMode,
    legacyFallbackCounts,
    warnings: summaryWarnings,
    totalsByPaymentMethod,
    changeAmountTotal: changeAmountTotalDecimal.toNumber(),
    refunds: refundsSummary,
    cashMovements: cashMovementsSummary,
    expectedVsCountedByCashSession,
    lateOfflineSyncCount,
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
    expectedCashTotal: d(expectedCashTotal._sum.expectedCashAmount).toNumber(),
    expectedCashPendingReviewTotal: d(expectedCashPendingReviewTotal._sum.expectedCashAmount).toNumber(),
    countedCashTotal: d(countedCashTotal._sum.countedCashAmount).toNumber(),
    cashDifferenceTotal: d(cashDifferenceTotal._sum.differenceAmount).toNumber(),
    openingCashTotal: openingCashTotalDecimal.toNumber(),
    cashTenderNetTotal: cashTenderNetTotalDecimal.toNumber(),
    cashMovementsNet: cashMovementsNetDecimal.toNumber(),
    cashExpensesTotal: cashExpensesTotalDecimal.toNumber(),
    cashOutflowsTotal: cashOutflowsTotalDecimal.toNumber(),
    cashInflowsTotal: cashInflowsTotalDecimal.toNumber(),
    expectedCashOnHand: expectedCashOnHandDecimal.toNumber(),
    cashNetWithoutOpening: expectedCashOnHandDecimal.sub(openingCashTotalDecimal).toNumber(),
    cardTenderTotal: cardTenderTotalDecimal.toNumber(),
    transferTenderTotal: transferTenderTotalDecimal.toNumber(),
    otherTenderTotal: otherTenderTotalDecimal.toNumber(),
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

/**
 * Cierra las cajas huérfanas (OPEN/RECONCILING) de un día que se está
 * barriendo a AWAITING_REVIEW, reutilizando el mismo cálculo de efectivo
 * esperado que ya usa cash-session (Decimal) — nunca se pierde el conteo
 * físico, solo queda pendiente de revisión.
 */
export async function closeOrphanedCashSessionsForDayTx(tx: Prisma.TransactionClient, dayId: string): Promise<number> {
  const orphanSessions = await tx.cashSession.findMany({
    where: { operationalDayId: dayId, status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] } },
    select: { id: true, openingAmount: true, physicalCashBoxId: true },
  });

  for (const session of orphanSessions) {
    const [cashTenders, cashMovements] = await Promise.all([
      tx.paymentTender.findMany({
        where: { method: PaymentMethod.CASH, payment: { cashSessionId: session.id, status: PaymentStatus.POSTED } },
        select: { amount: true },
      }),
      tx.cashMovement.findMany({ where: { cashSessionId: session.id }, select: { type: true, amount: true } }),
    ]);
    const postedCashPayments = cashTenderTotalDecimal(cashTenders.map((t) => ({ method: PaymentMethod.CASH, amount: t.amount })));
    const cashMovementsNet = cashMovementsNetTotalDecimal(cashMovements);
    const expectedCash = computeExpectedCashDecimal({ openingAmount: session.openingAmount, postedCashPayments, cashMovementsNet });

    await tx.cashSession.update({
      where: { id: session.id },
      data: {
        status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW,
        closedAt: new Date(),
        autoClosedAt: new Date(),
        autoClosedBySystem: true,
        autoClosedReason: "Dia operativo paso a espera de revision — caja huerfana cerrada para revision.",
        expectedCashAmount: expectedCash,
        countedCashAmount: null,
        differenceAmount: null,
        closingAmount: null,
        requiresReview: true,
        activeSessionKey: null,
      },
    });

    await tx.auditLog.create({
      data: {
        branchId: null,
        module: "operations",
        action: "OPERATIONAL_DAY_ORPHAN_CASH_SESSION_AUTO_CLOSED",
        entityType: "CashSession",
        entityId: session.id,
        metadataJson: { operationalDayId: dayId, physicalCashBoxId: session.physicalCashBoxId, expectedCash: expectedCash.toNumber() },
      },
    });
  }

  return orphanSessions.length;
}

/**
 * Checklist puramente INFORMATIVO — Día Operativo 360. No existe el concepto
 * de "bloqueante duro": cada ítem es OK o ATTENTION, y ninguno impide
 * confirmar el día. confirmOperationalDay (day-lifecycle.ts) exige nota si
 * hay algún ítem en ATTENTION, pero nunca rechaza la confirmación por sí sola.
 */
export function buildChecklist(
  summary: Awaited<ReturnType<typeof calculateOperationalSummaryTx>>,
  cashDifferenceToleranceAmount: number,
): OperationalDayChecklist {
  const items: ChecklistItem[] = [
    {
      key: "open_cash_sessions",
      label: "Cajas abiertas o en conciliacion",
      status: summary.openCashSessionsCount > 0 ? "ATTENTION" : "OK",
      count: summary.openCashSessionsCount,
      message: summary.openCashSessionsCount > 0
        ? "El cajero debe cerrar la sesión desde su caja, o Master desde /app/branch/cash."
        : undefined,
    },
    {
      key: "auto_closed_pending_review",
      label: "Cierres automaticos pendientes de revision",
      status: summary.autoClosedPendingReviewCount > 0 ? "ATTENTION" : "OK",
      count: summary.autoClosedPendingReviewCount,
      message: summary.autoClosedPendingReviewCount > 0
        ? "Requiere revisión manual del efectivo contado en /app/branch/cash."
        : undefined,
    },
    {
      key: "pending_payments",
      label: "Pagos pendientes",
      status: summary.pendingPaymentTotal > 0 ? "ATTENTION" : "OK",
      message: summary.pendingPaymentTotal > 0 ? `Pendiente: C$ ${summary.pendingPaymentTotal.toFixed(2)}` : undefined,
    },
    {
      key: "pending_dispatch",
      label: "Despachos pendientes",
      status: summary.pendingDispatchCount > 0 ? "ATTENTION" : "OK",
      count: summary.pendingDispatchCount,
    },
    {
      key: "critical_brain",
      label: "Decisiones criticas de Brain",
      status: summary.criticalBrainDecisionCount > 0 ? "ATTENTION" : "OK",
      count: summary.criticalBrainDecisionCount,
    },
    {
      key: "cash_difference",
      label: "Diferencia de caja",
      status: Math.abs(summary.cashDifferenceTotal) > cashDifferenceToleranceAmount ? "ATTENTION" : "OK",
      message: `Diferencia acumulada: C$ ${summary.cashDifferenceTotal.toFixed(2)} (tolerancia: C$ ${cashDifferenceToleranceAmount.toFixed(2)})`,
    },
  ];
  return {
    items,
    attention: items.filter((item) => item.status === "ATTENTION"),
    ok: items.filter((item) => item.status === "OK"),
    summary: summary as unknown as Record<string, unknown>,
  };
}

/**
 * Preview de solo lectura — el checklist que verá Master en el diálogo de
 * confirmación, sin escribir nada. Recalcula en vivo siempre (no lee el
 * snapshot), para reflejar el estado real al momento de abrir el diálogo.
 */
export async function previewOperationalDayChecklist(id: string) {
  const day = await prisma.operationalDay.findUniqueOrThrow({ where: { id } });
  const summary = await prisma.$transaction((tx) => calculateOperationalSummaryTx(tx, day));
  const toleranceConfig = await getCashToleranceConfig();
  const cashDifferenceToleranceAmount = resolveCashToleranceForBranch(toleranceConfig, day.branchId);
  const checklist = buildChecklist(summary, cashDifferenceToleranceAmount);
  return { day, summary, checklist };
}

export async function getDailyReport(id: string) {
  const day = await prisma.operationalDay.findUniqueOrThrow({
    where: { id },
    include: {
      branch: true,
      openedBy: { select: { id: true, username: true, fullName: true } },
      sweptBy: { select: { id: true, username: true, fullName: true } },
      reviewedBy: { select: { id: true, username: true, fullName: true } },
      cashSessions: { include: { physicalCashBox: true, openedBy: { select: { id: true, username: true, fullName: true } } } },
    },
  });
  const { start, end } = operationalWindow(day.businessDate);

  const ordersByDayWhere: Prisma.SaleOrderWhereInput = {
    branchId: day.branchId,
    OR: [{ operationalDayId: day.id }, { operationalDayId: null, createdAt: { gte: start, lt: end } }],
  };
  const paymentsByDayWhere: Prisma.PaymentWhereInput = {
    status: PaymentStatus.POSTED,
    saleOrder: { branchId: day.branchId },
    OR: [{ operationalDayId: day.id }, { operationalDayId: null, paidAt: { gte: start, lt: end } }],
  };

  const [
    orders,
    paymentsByMethod,
    dispatches,
    returns,
    cancellations,
    transports,
    chronoOrders,
    chronoPaymentsByMethod,
    legacyOrdersCount,
    legacyPaymentsCount,
    brain,
    audit,
  ] = await Promise.all([
    prisma.saleOrder.findMany({
      where: ordersByDayWhere,
      select: { id: true, orderNumber: true, status: true, grandTotal: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.payment.groupBy({
      by: ["method"],
      where: paymentsByDayWhere,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.dispatchTicket.findMany({
      where: {
        branchId: day.branchId,
        OR: [{ operationalDayId: day.id }, { operationalDayId: null, createdAt: { gte: start, lt: end } }],
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    prisma.saleReturn.findMany({
      where: { operationalDayId: day.id },
      select: { id: true, returnNumber: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    prisma.saleCancellation.findMany({
      where: { operationalDayId: day.id },
      select: { id: true, saleOrderId: true, status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    prisma.transportService.findMany({
      where: {
        branchId: day.branchId,
        OR: [{ operationalDayId: day.id }, { operationalDayId: null, createdAt: { gte: start, lt: end } }],
      },
      select: { id: true, status: true, price: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
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
    prisma.saleOrder.count({
      where: { branchId: day.branchId, operationalDayId: null, createdAt: { gte: start, lt: end } },
    }),
    prisma.payment.count({
      where: { status: PaymentStatus.POSTED, operationalDayId: null, paidAt: { gte: start, lt: end }, saleOrder: { branchId: day.branchId } },
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

  // Un día CONFIRMADO lee su firma (reviewSummaryJson), nunca recalcula — es
  // el número que Master firmó. Cualquier otro (ACTIVE o AWAITING_REVIEW,
  // todavía PENDING) se calcula en vivo, marcado como tal.
  let summary: Record<string, unknown>;
  let summarySource: "SNAPSHOT" | "LIVE";
  if (day.reviewStatus === "CONFIRMED" && day.reviewSummaryJson) {
    summary = day.reviewSummaryJson as Record<string, unknown>;
    summarySource = "SNAPSHOT";
  } else {
    summary = await prisma.$transaction((tx) => calculateOperationalSummaryTx(tx, day));
    summarySource = "LIVE";
  }

  const lateActivityOrders = day.sweptAt
    ? await prisma.saleOrder.findMany({
        where: { operationalDayId: day.id, offlineClientId: { not: null }, syncedAt: { gt: day.sweptAt } },
        select: { id: true, orderNumber: true, grandTotal: true, syncedAt: true, createdAt: true },
        orderBy: { syncedAt: "asc" },
        take: 100,
      })
    : [];

  return {
    day,
    orders,
    paymentsByMethod,
    dispatches,
    brain,
    audit,
    window: { start, end, timezone: TIMEZONE },
    summary,
    summarySource,
    lateActivity: { orders: lateActivityOrders, count: lateActivityOrders.length },
    operations: { orders, paymentsByMethod, dispatches, returns, cancellations, transports },
    chronological: { orders: chronoOrders, paymentsByMethod: chronoPaymentsByMethod, window: { start, end, timezone: TIMEZONE } },
    legacyFallback: { ordersWithoutOperationalDay: legacyOrdersCount, paymentsWithoutOperationalDay: legacyPaymentsCount },
  };
}

export async function getOperationalDayBranchId(id: string) {
  const day = await prisma.operationalDay.findUniqueOrThrow({ where: { id }, select: { branchId: true } });
  return day.branchId;
}

export async function listOperationalDays(filters: {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  branchId?: string;
  lifecycle?: "ACTIVE" | "AWAITING_REVIEW" | "CANCELLED";
  reviewStatus?: "PENDING" | "CONFIRMED";
  hasIssues?: boolean;
}) {
  const businessDate = filters.date     ? businessDateFromInputSafe(filters.date)     : undefined;
  const dateFromVal  = filters.dateFrom ? businessDateFromInputSafe(filters.dateFrom) : undefined;
  const dateToVal    = filters.dateTo   ? businessDateFromInputSafe(filters.dateTo)   : undefined;

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
  if (filters.lifecycle) where.lifecycle = filters.lifecycle;
  if (filters.reviewStatus) where.reviewStatus = filters.reviewStatus;

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
      reviewedBy: { select: { id: true, username: true, fullName: true } },
    },
    orderBy: [{ businessDate: "desc" }, { openedAt: "desc" }],
    take: 200,
  });
}

// Import local para evitar ciclo con business-date.ts en el filtro de fechas.
function businessDateFromInputSafe(input: string) {
  const [year, month, day] = input.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

export type OperationalDayDerivedState = "ACTIVE_TODAY" | "AWAITING_REVIEW" | "CONFIRMED" | "NO_ACTIVITY";

/** Estado derivado simplificado — Día Operativo 360 (dos ejes, sin compuertas). */
export function deriveOperationalDayState(
  day: { lifecycle: string; reviewStatus: string } | null,
): OperationalDayDerivedState {
  if (!day) return "NO_ACTIVITY";
  if (day.reviewStatus === "CONFIRMED") return "CONFIRMED";
  if (day.lifecycle === "ACTIVE") return "ACTIVE_TODAY";
  return "AWAITING_REVIEW";
}

type BranchLiveStatus = {
  branchId: string;
  branchCode: string;
  branchName: string;
  businessDate: string | null;
  operationalDayId: string | null;
  lifecycle: string | null;
  reviewStatus: string | null;
  derivedState: OperationalDayDerivedState;
  blockers: {
    openCashSessions: number;
    reconcilingCashSessions: number;
    autoClosedPendingReview: number;
    staleActiveOperationalDays: number;
    staleCashSessions: number;
  };
  alerts: {
    pendingPaymentOrdersToday: number;
    pendingDispatchToday: number;
    criticalBrainOpen: number;
  };
  totalBlockers: number;
};

/**
 * Vista en vivo para Master — puramente informativa. `totalBlockers` solo
 * cuenta estados genuinamente atascados (día ACTIVE de fecha pasada que el
 * barrido todavía no alcanzó, cajas abandonadas de un día anterior); la cola
 * de confirmación pendiente (`pendingReviewDaysCount`) nunca cuenta como
 * bloqueante — puede esperar indefinidamente sin que nadie tenga que actuar.
 */
export async function getLiveBlockers(): Promise<{
  total: number;
  branches: BranchLiveStatus[];
  computedAt: string;
  pendingReviewDaysCount: number;
}> {
  const today = businessDateFromNow();
  const { start, end } = operationalWindow(today);
  const pendingReviewDaysCount = await prisma.operationalDay.count({
    where: { lifecycle: "AWAITING_REVIEW", reviewStatus: "PENDING" },
  });

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  const branchResults = await Promise.all(
    branches.map(async (branch): Promise<BranchLiveStatus> => {
      const [
        todayDay,
        staleActiveDaysCount,
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
          select: { id: true, lifecycle: true, reviewStatus: true, businessDate: true },
        }),
        prisma.operationalDay.count({
          where: { branchId: branch.id, lifecycle: "ACTIVE", businessDate: { not: today } },
        }),
        prisma.cashSession.count({
          where: { status: CashSessionStatus.OPEN, physicalCashBox: { branchId: branch.id }, operationalDay: { businessDate: today } },
        }),
        prisma.cashSession.count({
          where: { status: CashSessionStatus.RECONCILING, physicalCashBox: { branchId: branch.id }, operationalDay: { businessDate: today } },
        }),
        prisma.cashSession.count({
          where: {
            status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] },
            physicalCashBox: { branchId: branch.id },
            OR: [{ operationalDayId: null }, { operationalDay: { businessDate: { not: today } } }],
          },
        }),
        prisma.cashSession.count({
          where: { status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW, requiresReview: true, physicalCashBox: { branchId: branch.id } },
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
        staleActiveOperationalDays: staleActiveDaysCount,
        staleCashSessions: staleCashSessionsCount,
      };

      const totalBlockers = blockers.staleActiveOperationalDays + blockers.staleCashSessions;

      return {
        branchId: branch.id,
        branchCode: branch.code,
        branchName: branch.name,
        businessDate: todayDay?.businessDate.toISOString() ?? null,
        operationalDayId: todayDay?.id ?? null,
        lifecycle: todayDay?.lifecycle ?? null,
        reviewStatus: todayDay?.reviewStatus ?? null,
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
    pendingReviewDaysCount,
  };
}
