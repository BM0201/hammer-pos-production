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
import { getCashToleranceConfig, resolveCashToleranceForBranch } from "@/modules/operations/cash-tolerance-config";
import {
  cashMovementsNetTotalDecimal,
  cashTenderTotalDecimal,
  computeExpectedCashDecimal,
  isCashOutflowType,
  tenderTotalsByMethodDecimal,
} from "@/modules/cash-session/expected-cash";
import { refreshReplenishmentSignalSnapshot } from "@/modules/inventory/replenishment-service";

export const OPERATIONAL_TIMEZONE = "America/Managua";
const TIMEZONE = OPERATIONAL_TIMEZONE;
const ACTIVE_DISPATCH_STATUSES = ["PENDING", "IN_PROGRESS"] as const;
function decimal(value: number) {
  return new Prisma.Decimal(Number.isFinite(value) ? value : 0);
}

function n(value: Prisma.Decimal | number | string | null | undefined) {
  return Number(value ?? 0);
}

/**
 * Día Operativo v2 Fase 1 — coerción a Decimal para MONTOS (nunca para
 * conteos/enteros, que siguen usando `n()`). Todo subtotal de dinero en
 * `calculateOperationalSummaryTx` debe acumularse con `.add()`/`.sub()` sobre
 * este tipo, no con `+` sobre `number` — sumar en `number` arrastra drift de
 * punto flotante que se congela en el snapshot del cierre (ver expected-cash.ts).
 */
function d(value: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal {
  return new Prisma.Decimal(value ?? 0);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Resuelve (EXECUTED) la decisión de Brain "Dia operativo cerrado con
 * advertencias" de un día al aprobarlo — Master ya revisó y aceptó el cierre,
 * así que la advertencia dejó de estar pendiente. Antes esta decisión nunca se
 * tocaba después de creada: quedaba OPEN para siempre salvo el barrido pasivo
 * de 7 días (expireStaleBrainDecisions), lo que hacía que días ya aprobados
 * hace semanas siguieran apareciendo como pendientes en el Brain.
 *
 * No toca decisiones ya DISMISSED (Master las descartó explícitamente) — solo
 * cierra las que seguían abiertas.
 */
async function resolveClosedWithWarningsDecisionTx(
  tx: Prisma.TransactionClient,
  dayId: string,
  actorUserId: string,
) {
  const fingerprint = `operations:closed-with-warnings:${dayId}`;
  const { count } = await tx.brainDecision.updateMany({
    where: { fingerprint, status: { notIn: ["EXECUTED", "DISMISSED"] } },
    data: { status: "EXECUTED", resolvedAt: new Date(), resolvedByUserId: actorUserId },
  });
  if (count > 0) {
    const decision = await tx.brainDecision.findUnique({ where: { fingerprint }, select: { id: true } });
    if (decision) {
      await tx.brainDecisionActionLog.create({
        data: {
          decisionId: decision.id,
          actorUserId,
          action: "EXECUTED",
          note: "Resuelto automáticamente al aprobar el día operativo.",
        },
      });
    }
  }
}

/** Hora (0–23) a la que termina el día de negocio. 0 = medianoche (comportamiento por defecto). */
export const DEFAULT_BUSINESS_DAY_ENDS_AT_HOURS = 0;

function localWallClockParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/**
 * Fecha de negocio (a las 00:00 UTC) a la que pertenece un instante, según la
 * zona horaria y la hora de corte del día de negocio.
 *
 * ERP real: si businessDayEndsAt = 3 (03:00), una venta a las 02:30 AM pertenece
 * al día anterior, porque el día de negocio aún no había cerrado. Con
 * businessDayEndsAt = 0 (default) es simplemente la fecha calendario local.
 *
 * Pura y exportada para tests (no usa `new Date()` salvo el instante recibido).
 */
export function businessDateFromInstant(
  instant: Date,
  timezone: string = TIMEZONE,
  businessDayEndsAt: number = DEFAULT_BUSINESS_DAY_ENDS_AT_HOURS,
): Date {
  const { year, month, day, hour } = localWallClockParts(instant, timezone);
  let utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  // Antes de la hora de corte → todavía es el día de negocio anterior.
  if (businessDayEndsAt > 0 && hour < businessDayEndsAt) {
    utcMidnight -= 24 * 60 * 60 * 1000;
  }
  return new Date(utcMidnight);
}

export function businessDateFromNow(now = new Date()) {
  return businessDateFromInstant(now, TIMEZONE, DEFAULT_BUSINESS_DAY_ENDS_AT_HOURS);
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

export async function calculateOperationalSummaryTx(tx: Prisma.TransactionClient, day: { id: string; branchId: string; businessDate: Date; closedAt?: Date | null }) {
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
        // Híbrido: por operationalDayId si está poblado; si no, ventana legacy.
        OR: [
          { operationalDayId: day.id },
          { operationalDayId: null, createdAt: { gte: start, lt: end } },
        ],
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
    // expected/counted/difference comparan el MISMO conjunto (requiresReview:
    // false): antes expected incluía sesiones sin revisar y counted no, y
    // cashDifferenceTotal no cuadraba con expected − counted. Las sesiones
    // pendientes de revisión se exponen aparte (expectedCashPendingReviewTotal).
    tx.cashSession.aggregate({ where: { operationalDayId: day.id, requiresReview: false }, _sum: { expectedCashAmount: true } }),
    tx.cashSession.aggregate({ where: { operationalDayId: day.id, requiresReview: true }, _sum: { expectedCashAmount: true } }),
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
    // Día Operativo v2 Fase 2 — este ya NO es "ventana = todo lo demás": es
    // específicamente el resto AÚN NO MIGRADO (operationalDayId: null) dentro
    // de la ventana. Sin ese filtro, en modo MIXED se descartaban en silencio
    // los tenders sin id (useIdTenders prefería SOLO dayTendersById), y el
    // total quedaba por debajo del real. Ahora es el complemento exacto y
    // mutuamente excluyente de dayTendersById — la unión de ambos es completa
    // y sin doble conteo por construcción (uno exige operationalDayId ===
    // day.id, el otro exige operationalDayId === null).
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

  // ── Fuente de verdad: preferir operationalDayId; ventana horaria = fallback legacy ──
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

  // Fase 2: el conjunto efectivo es SIEMPRE completo — todos los tenders con
  // operationalDayId (la fuente confiable) MÁS los que aún no migraron (sin
  // id, dentro de la ventana). Antes, en modo MIXED, se usaban SOLO los
  // tenders con id y se descartaban en silencio los de ventana sin migrar —
  // el total mostrado quedaba por debajo del real. sourceMode/warnings siguen
  // existiendo para trazabilidad, pero el monto ya no depende de ellos.
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

  // Totales por método usando PaymentTender de la fuente elegida.
  // FIX doble resta del vuelto: `net` === `amount` (tender.amount ya es el
  // monto aplicado; el vuelto sale del excedente recibido). `changeAmount`
  // sigue expuesto como campo informativo separado. Ver expected-cash.ts.
  // Fase 1 (Decimal): toda esta sección acumula en Prisma.Decimal — sumar en
  // `number` arrastra drift de punto flotante que se congelaba en el snapshot
  // del cierre (p.ej. 62,900.0000000113 en vez de 62,900.00).
  const totalsByPaymentMethodDecimal = tenderTotalsByMethodDecimal(effectiveTenders);
  const totalsByPaymentMethod = Object.fromEntries(
    Object.entries(totalsByPaymentMethodDecimal).map(([method, totals]) => [
      method,
      { amount: totals.amount.toNumber(), changeAmount: totals.changeAmount.toNumber(), net: totals.net.toNumber() },
    ]),
  );

  const openingCashTotalDecimal = cashSessions.reduce((sum, session) => sum.add(session.openingAmount), d(0));
  // Σ amount de tenders CASH, SIN restar vuelto (misma regla que el esperado
  // por sesión). Se conserva el nombre por compatibilidad con closeSummaryJson.
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
  // Break the net movements into gross inflows / outflows so the Master can see
  // exactly how much was spent or taken out of the box ("gasto de caja").
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

  // ── H: vuelto entregado, devoluciones, movimientos de caja y expected vs counted por caja ──
  const changeAmountTotalDecimal = effectiveTenders.reduce((sum, tender) => sum.add(tender.changeAmount ?? 0), d(0));

  // Devoluciones del día: por operationalDayId; fallback a las ligadas a una caja del día.
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

  // Ventas offline sincronizadas DESPUÉS del cierre del día = pendientes de revisión
  // (no se metieron en el día de hoy solo por sincronizar; entraron tarde a un día ya cerrado).
  // En un día OPEN no aplica (sincronizar contra el día en curso es normal) → 0.
  const lateOfflineSyncCount = day.closedAt
    ? await tx.saleOrder.count({
        where: { operationalDayId: day.id, offlineClientId: { not: null }, syncedAt: { gt: day.closedAt } },
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
    // Trazabilidad de la fuente del cálculo (ERP): operationalDayId vs ventana legacy.
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
    // Esperado de sesiones AUTO_CLOSED_PENDING_REVIEW (fuera del comparativo).
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

export async function getOpenOperationalDayForBranchTx(tx: Prisma.TransactionClient, branchId: string) {
  return tx.operationalDay.findFirst({
    where: { branchId, status: OperationalDayStatus.OPEN },
    orderBy: { openedAt: "desc" },
  });
}

/**
 * Día Operativo v2 Fase 5 — cierra las cajas huérfanas (OPEN/RECONCILING) de
 * un día que se está barriendo a PENDING_CLOSE, reutilizando el MISMO cálculo
 * de efectivo esperado que ya usa cash-session (Decimal, ver Fase 1) — nunca
 * se pierde el conteo físico, solo queda pendiente de revisión
 * (AUTO_CLOSED_PENDING_REVIEW, el estado que ya existe para esto).
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
        autoClosedReason: "Dia operativo paso a Pendiente de cierre — caja huerfana cerrada para revision.",
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
 * Día Operativo v2 Fase 5 (el corazón) — barre un día OPEN de fecha pasada a
 * PENDING_CLOSE: SALE de "abierto" (deja de bloquear), cierra sus cajas
 * huérfanas para revisión, conserva toda su data intacta. NUNCA lo finaliza
 * (nunca CLOSED) — un humano lo concilia y cierra después, con la ventana de
 * SU fecha (closeOperationalDay ya soporta esto, ver 5.4). Idempotente: si el
 * día ya no está OPEN cuando se reclama, no hace nada.
 */
export async function sweepDayToPendingCloseTx(
  tx: Prisma.TransactionClient,
  day: { id: string; branchId: string; businessDate: Date },
  actorUserId?: string,
): Promise<void> {
  const claimed = await tx.operationalDay.updateMany({
    where: { id: day.id, status: OperationalDayStatus.OPEN },
    data: { status: OperationalDayStatus.PENDING_CLOSE },
  });
  if (claimed.count !== 1) return;

  const orphanCashSessionsClosed = await closeOrphanedCashSessionsForDayTx(tx, day.id);

  await tx.auditLog.create({
    data: {
      actorUserId: actorUserId && actorUserId !== "SYSTEM" ? actorUserId : null,
      branchId: day.branchId,
      module: "operations",
      action: "OPERATIONAL_DAY_SWEPT_TO_PENDING_CLOSE",
      entityType: "OperationalDay",
      entityId: day.id,
      metadataJson: {
        businessDate: day.businessDate,
        orphanCashSessionsClosed,
        reason: "Paso su fecha sin cerrarse — nunca se pierde ni bloquea, espera cierre humano en la cola de pendientes.",
      },
    },
  });
}

/**
 * Día Operativo v2 Fase 5.3 (vía proactiva) — barrido periódico (cron) de
 * TODOS los días OPEN de fecha pasada, en cualquier sucursal, a
 * PENDING_CLOSE. Reemplaza a la vieja `autoCloseOperationalDays`, que
 * detectaba estos días stale y solo empujaba un error
 * `STALE_OPEN_OPERATIONAL_DAY:...` en cada corrida, sin resolverlos nunca.
 * Este barrido NUNCA finaliza (CLOSED) un día — solo lo saca de "abierto" y
 * lo deja esperando en la cola; cerrarlo lo hace un humano
 * (closeOperationalDay ya acepta PENDING_CLOSE).
 */
export async function sweepStaleOperationalDaysToPendingClose(
  input: { now?: Date; dryRun?: boolean } = {},
): Promise<{ scanned: number; sweptToPendingClose: number; errors: Array<{ branchId: string; message: string }> }> {
  const today = businessDateFromNow(input.now);
  const staleOpenDays = await prisma.operationalDay.findMany({
    where: { status: OperationalDayStatus.OPEN, businessDate: { lt: today } },
    select: { id: true, branchId: true, businessDate: true },
    take: 200,
  });

  if (input.dryRun) {
    return { scanned: staleOpenDays.length, sweptToPendingClose: 0, errors: [] };
  }

  let sweptToPendingClose = 0;
  const errors: Array<{ branchId: string; message: string }> = [];
  for (const day of staleOpenDays) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${day.id} FOR UPDATE`;
        await sweepDayToPendingCloseTx(tx, day, "SYSTEM");
      });
      sweptToPendingClose += 1;
    } catch (err) {
      errors.push({ branchId: day.branchId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { scanned: staleOpenDays.length, sweptToPendingClose, errors };
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
    // Fase 5: un día OPEN de fecha pasada (stale) YA NO bloquea — se barre a
    // PENDING_CLOSE (sale de "abierto", conserva su data, espera cierre
    // humano) y se sigue de largo para abrir/usar el día de HOY.
    const todayBusinessDate = businessDateFromNow();
    if (day.businessDate.getTime() !== todayBusinessDate.getTime()) {
      await sweepDayToPendingCloseTx(tx, day, openedByUserId);
    } else {
      return day;
    }
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

// ── Estado del día operativo actual ───────────────────────────────────────────

export type CurrentOperationalDayState =
  | "NO_DAY"
  | "OPEN_TODAY"
  | "STALE_OPEN_DAY"
  | "CLOSED_TODAY"
  | "CLOSING"
  | "ERROR";

type OperationalDayStateInfo = {
  id: string;
  status: OperationalDayStatus;
  businessDate: Date;
  approvedAt: Date | null;
  openedAt: Date;
};

/**
 * Estado del día operativo de una sucursal AHORA (no devuelve null cuando hay un
 * día viejo abierto: devuelve STALE_OPEN_DAY con los datos del día viejo).
 */
export async function getCurrentOperationalDayState(branchId: string): Promise<{
  state: CurrentOperationalDayState;
  day: OperationalDayStateInfo | null;
  staleDay: OperationalDayStateInfo | null;
}> {
  try {
    const today = businessDateFromNow();
    const select = { id: true, status: true, businessDate: true, approvedAt: true, openedAt: true } as const;
    const [todayDay, anyOpenDay] = await Promise.all([
      prisma.operationalDay.findUnique({
        where: { branchId_businessDate: { branchId, businessDate: today } },
        select,
      }),
      prisma.operationalDay.findFirst({
        where: { branchId, status: OperationalDayStatus.OPEN },
        orderBy: { openedAt: "desc" },
        select,
      }),
    ]);

    // Día viejo abierto (de una fecha anterior) → estado atascado real.
    if (anyOpenDay && anyOpenDay.businessDate.getTime() !== today.getTime()) {
      return { state: "STALE_OPEN_DAY", day: anyOpenDay, staleDay: anyOpenDay };
    }
    if (!todayDay) return { state: "NO_DAY", day: null, staleDay: null };

    let state: CurrentOperationalDayState;
    switch (todayDay.status) {
      case OperationalDayStatus.OPEN:
        state = "OPEN_TODAY";
        break;
      case OperationalDayStatus.CLOSING:
        state = "CLOSING";
        break;
      case OperationalDayStatus.CLOSED:
      case OperationalDayStatus.CANCELLED:
      case OperationalDayStatus.REOPENED_FOR_ADJUSTMENT:
        // Reabierto para ajuste = finalizado en revisión, NO operación normal.
        state = "CLOSED_TODAY";
        break;
      default:
        state = "ERROR";
    }
    return { state, day: todayDay, staleDay: null };
  } catch {
    return { state: "ERROR", day: null, staleDay: null };
  }
}

/**
 * Resuelve el día operativo OPEN al que debe asentarse una operación nueva
 * (venta/pago). Decisión de negocio: mantener auto-apertura + warn cuando no
 * hay día OPEN (no bloquea el POS). Fase 5: un día OPEN viejo (stale) YA NO
 * bloquea — se barre a PENDING_CLOSE (sale de "abierto", nunca se pierde) y
 * la operación se asienta en el día de HOY, recién auto-abierto. El único
 * "escape" del modelo viejo (forzar hoy contra el día de ayer, corrompiendo
 * ambos) deja de existir — no hace falta, hoy simplemente abre solo.
 *
 * Debe ejecutarse dentro de una transacción.
 */
export async function resolveOpenOperationalDayForOperationTx(
  tx: Prisma.TransactionClient,
  branchId: string,
  occurredAt: Date = new Date(),
  options?: { openedByUserId?: string },
): Promise<{ operationalDayId: string; autoOpened: boolean; warnings: string[] }> {
  const open = await getOpenOperationalDayForBranchTx(tx, branchId);
  const today = businessDateFromNow(occurredAt);
  if (open) {
    const isStale = open.businessDate.getTime() !== today.getTime();
    if (!isStale) {
      return { operationalDayId: open.id, autoOpened: false, warnings: [] };
    }
    await sweepDayToPendingCloseTx(tx, open, options?.openedByUserId);
  }
  // Sin día OPEN (o el que había era stale y se acaba de barrer) →
  // auto-apertura del día de hoy (Managua) + warn.
  const created = await ensureOpenOperationalDayTx(tx, branchId, options?.openedByUserId);
  return { operationalDayId: created.id, autoOpened: true, warnings: ["OPERATIONAL_DAY_AUTO_OPENED"] };
}

function buildChecklist(
  summary: Awaited<ReturnType<typeof calculateOperationalSummaryTx>>,
  dayStatus: OperationalDayStatus,
  cashDifferenceToleranceAmount: number,
): OperationalDayClosePreview {
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
      status: Math.abs(summary.cashDifferenceTotal) > cashDifferenceToleranceAmount ? "WARNING" : "OK",
      message: `Diferencia acumulada: C$ ${summary.cashDifferenceTotal.toFixed(2)} (tolerancia: C$ ${cashDifferenceToleranceAmount.toFixed(2)})`,
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
  const full = await prisma.operationalDay.findUnique({
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
  if (!full) return null;

  // Campo transitorio (no persistido): ventas offline sincronizadas tras el cierre,
  // pendientes de revisión. Se calcula EN VIVO para que un día CLOSED-pendiente lo
  // muestre aunque su snapshot de cierre no se haya regenerado.
  const lateOfflineSyncCount = full.closedAt
    ? await prisma.saleOrder.count({
        where: { operationalDayId: full.id, offlineClientId: { not: null }, syncedAt: { gt: full.closedAt } },
      })
    : 0;

  return { ...full, lateOfflineSyncCount };
}

export async function openOperationalDay(input: { branchId: string; businessDate?: string; notes?: string | null; actorUserId: string; isMaster?: boolean }) {
  return prisma.$transaction(async (tx) => {
    // Lock the branch row to serialize concurrent opens that would otherwise
    // race to create the operational day and hit @@unique([branchId, businessDate]).
    await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${input.branchId} FOR UPDATE`;

    const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
    if (!branch?.isActive) throw new Error("BRANCH_NOT_ACTIVE");

    const businessDate = businessDateFromInput(input.businessDate);

    // I: reglas de apertura por rol/fecha (Managua).
    //  - No-Master solo puede abrir el día de HOY.
    //  - Master puede abrir otra fecha (pasada o futura) SOLO con nota obligatoria.
    //  - Fecha futura nunca para no-Master (override Master con nota).
    const today = businessDateFromNow();
    const isToday = businessDate.getTime() === today.getTime();
    const isFuture = businessDate.getTime() > today.getTime();
    if (!isToday) {
      if (!input.isMaster) {
        throw new Error(isFuture ? "OPERATIONAL_DAY_OPEN_FUTURE_NOT_ALLOWED" : "OPERATIONAL_DAY_OPEN_DATE_NOT_TODAY");
      }
      if (!input.notes?.trim()) {
        throw new Error("OPERATIONAL_DAY_OPEN_DATE_NOTE_REQUIRED");
      }
    }

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
    const toleranceConfig = await getCashToleranceConfig();
    const preview = buildChecklist(summary, day.status, resolveCashToleranceForBranch(toleranceConfig, day.branchId));
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

/**
 * Revierte un día atascado en CLOSING de vuelta a su estado ANTERIOR
 * (best-effort). Solo actúa si el día sigue en CLOSING (condición en
 * updateMany) para no pisar un estado válido.
 *
 * Fase 5: ahora hay TRES orígenes posibles de CLOSING (OPEN de hoy,
 * REOPENED_FOR_ADJUSTMENT tras un ajuste, o PENDING_CLOSE de la cola) — el
 * heurístico viejo ("hoy → OPEN, si no → REOPENED_FOR_ADJUSTMENT") ya no
 * alcanza: revertir un PENDING_CLOSE fallido a REOPENED_FOR_ADJUSTMENT lo
 * sacaría de la cola de pendientes incorrectamente. Se revierte al
 * `originalStatus` exacto que closeOperationalDay capturó antes de reclamar
 * CLOSING — deshace la transición, no la adivina.
 */
async function revertClosingToOpenTx(
  actorUserId: string,
  dayId: string,
  originalStatus: OperationalDayStatus,
  reason: string,
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${dayId} FOR UPDATE`;
    const day = await tx.operationalDay.findUnique({ where: { id: dayId }, select: { branchId: true, status: true } });
    if (!day || day.status !== OperationalDayStatus.CLOSING) return;
    await tx.operationalDay.update({ where: { id: dayId }, data: { status: originalStatus } });
    await tx.auditLog.create({
      data: {
        actorUserId,
        branchId: day.branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_CLOSE_FAILED_REVERTED",
        entityType: "OperationalDay",
        entityId: dayId,
        metadataJson: { reason, revertedFrom: "CLOSING", revertedTo: originalStatus },
      },
    });
  });
}

/**
 * Cierre de día operativo con máquina de estados real OPEN → CLOSING → CLOSED.
 *
 * Fase 1 (atómica): bloquea el día (FOR UPDATE) y reclama la transición OPEN→CLOSING
 *   con updateMany condicional. Esto evita el doble cierre concurrente (el segundo
 *   intento bloquea en el lock y luego ve CLOSING/CLOSED) y CONGELA el día (las
 *   ventas nuevas exigen día OPEN) mientras se calcula el cierre.
 * Fase 2: recalcula summary por operationalDayId, valida blockers/nota y finaliza
 *   CLOSING→CLOSED guardando snapshots inmutables. Si algo falla (blocker, nota,
 *   error), se revierte CLOSING→OPEN y se audita el fallo.
 */
export async function closeOperationalDay(input: {
  id: string;
  actorUserId: string;
  note?: string | null;
  forceClose?: boolean;
  isMaster?: boolean;
  acknowledgedWarnings?: string[];
}) {
  // ── Fase 1: reclamar CLOSING atómicamente ──────────────────────────────────
  let originalStatus: OperationalDayStatus = OperationalDayStatus.OPEN;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${input.id} FOR UPDATE`;
    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });
    if (day.status === OperationalDayStatus.CLOSED) throw new Error("OPERATIONAL_DAY_ALREADY_CLOSED");
    if (day.status === OperationalDayStatus.CANCELLED) throw new Error("OPERATIONAL_DAY_NOT_OPEN");
    if (day.status === OperationalDayStatus.CLOSING) throw new Error("OPERATIONAL_DAY_CLOSING_IN_PROGRESS");
    // Cerrable desde OPEN, REOPENED_FOR_ADJUSTMENT (re-finalizar tras un ajuste
    // Master), o PENDING_CLOSE (Fase 5: cierre tardío de un día barrido — usa
    // la ventana de SU businessDate, no la de hoy, sin cambios adicionales).
    const closeableSources = [OperationalDayStatus.OPEN, OperationalDayStatus.REOPENED_FOR_ADJUSTMENT, OperationalDayStatus.PENDING_CLOSE];
    if (!closeableSources.includes(day.status)) throw new Error("OPERATIONAL_DAY_NOT_OPEN");
    originalStatus = day.status;

    const claimed = await tx.operationalDay.updateMany({
      where: { id: input.id, status: { in: closeableSources } },
      data: { status: OperationalDayStatus.CLOSING },
    });
    if (claimed.count !== 1) throw new Error("OPERATIONAL_DAY_CLOSING_IN_PROGRESS");

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: day.branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_CLOSING_STARTED",
        entityType: "OperationalDay",
        entityId: day.id,
        metadataJson: { forceClose: Boolean(input.forceClose) },
      },
    });
  });

  // ── Fase 2: calcular + validar + finalizar (con reversión ante error) ──────
  try {
    const closed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${input.id} FOR UPDATE`;
      const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });
      if (day.status !== OperationalDayStatus.CLOSING) throw new Error("OPERATIONAL_DAY_NOT_CLOSING");

      const summary = await calculateOperationalSummaryTx(tx, day);
      const toleranceConfig = await getCashToleranceConfig();
      const cashDifferenceToleranceAmount = resolveCashToleranceForBranch(toleranceConfig, day.branchId);
      const preview = buildChecklist(summary, day.status, cashDifferenceToleranceAmount);
      const hasWarnings = preview.warnings.length > 0;
      const hardBlockers = preview.blockers.filter((item) => isHardOperationalDayCloseBlocker(item.key));
      if (hardBlockers.length > 0) {
        throw new Error("OPERATIONAL_DAY_HAS_HARD_BLOCKERS");
      }
      if (preview.blockers.length > 0 && !(input.forceClose && input.isMaster)) {
        throw new Error("OPERATIONAL_DAY_HAS_BLOCKERS");
      }
      // M: las advertencias relevantes deben reconocerse (acknowledgedWarnings) O
      // justificarse con nota. Un forceClose siempre exige nota.
      const warningKeys = preview.warnings.map((w) => w.key);
      const acked = new Set(input.acknowledgedWarnings ?? []);
      const allWarningsAcknowledged = warningKeys.every((k) => acked.has(k));
      if (hasWarnings && !allWarningsAcknowledged && !input.note?.trim()) {
        throw new Error("OPERATIONAL_DAY_CLOSE_NOTE_REQUIRED");
      }
      if (input.forceClose && !input.note?.trim()) {
        throw new Error("OPERATIONAL_DAY_CLOSE_NOTE_REQUIRED");
      }

      const closed = await tx.operationalDay.update({
        where: { id: input.id },
        data: {
          status: OperationalDayStatus.CLOSED,
          closedByUserId: input.actorUserId,
          closedAt: new Date(),
          notes: input.note ?? day.notes,
          closeChecklistJson: toJsonValue({ ...preview, acknowledgedWarnings: input.acknowledgedWarnings ?? [] }),
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
            sourceMode: summary.sourceMode,
            acknowledgedWarnings: input.acknowledgedWarnings ?? [],
            checklist: preview,
            summary,
          }),
        },
      });

      if (preview.warnings.length > 0 || Math.abs(summary.cashDifferenceTotal) > cashDifferenceToleranceAmount) {
        const warningsFingerprint = `operations:closed-with-warnings:${day.id}`;
        // No se reabre si Master ya la descartó explícitamente (DISMISSED) — un
        // re-cierre (día reabierto para ajuste) SÍ reabre si estaba ya resuelta
        // (EXECUTED por una aprobación previa), porque es una nueva advertencia.
        const existingWarningDecision = await tx.brainDecision.findUnique({
          where: { fingerprint: warningsFingerprint },
          select: { status: true },
        });
        await tx.brainDecision.upsert({
          where: { fingerprint: warningsFingerprint },
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
            fingerprint: warningsFingerprint,
            idempotencyKey: `brain:operations:closed-with-warnings:${day.id}`,
          },
          update: {
            evidenceJson: toJsonValue({ operationalDayId: day.id, checklist: preview, summary }),
            ...(existingWarningDecision?.status === "DISMISSED"
              ? {}
              : { status: "OPEN", resolvedAt: null, resolvedByUserId: null }),
          },
        });
      }

      return closed;
    });

    // Fase 1.5 (Reposición v2): refrescar snapshot de señales DESPUÉS del cierre,
    // nunca dentro de la transacción del día (el ciclo del día es sensible).
    // Best-effort: un fallo acá jamás debe revertir ni bloquear el cierre.
    refreshReplenishmentSignalSnapshot(closed.branchId).catch(() => {});

    return closed;
  } catch (error) {
    // El día quedó en CLOSING por un fallo/blocker → revertir a su estado anterior.
    await revertClosingToOpenTx(
      input.actorUserId,
      input.id,
      originalStatus,
      error instanceof Error ? error.message : "UNKNOWN_CLOSE_ERROR",
    );
    throw error;
  }
}

export type OperationalDayBlocker = {
  code: string;
  label: string;
  /** Conteo REAL (count()), no limitado por el tamaño del sample. */
  count: number;
  /** Muestra de referencias (hasta `sampleLimit`). */
  references: Array<{
    id: string;
    ref?: string;
    status?: string;
    date?: string;
    resolve?: { kind: string; href: string; entityId: string };
  }>;
  sampleLimit: number;
  hasMore: boolean;
};

const BLOCKER_SAMPLE_LIMIT = 20;

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
  // Fuente de verdad por operationalDayId. Devoluciones/anulaciones/pagos pendientes
  // se acotan al día (operationalDayId = day.id). Transportes aún no tienen el id
  // poblado en datos legacy → se mantienen por ventana como fallback.
  // M: se hace count() REAL para el total y findMany(take 20) solo como muestra.
  const { start, end } = operationalWindow(day.businessDate);

  const returnWhere: Prisma.SaleReturnWhereInput = { operationalDayId: day.id, status: { in: ["REQUESTED", "APPROVED"] } };
  const cancellationWhere: Prisma.SaleCancellationWhereInput = { operationalDayId: day.id, status: { in: ["REQUESTED", "APPROVED"] } };
  const transportWhere: Prisma.TransportServiceWhereInput = {
    branchId: day.branchId,
    status: { in: ["PENDING", "IN_TRANSIT"] },
    createdAt: { gte: start, lt: end },
  };
  const sessionWhere: Prisma.CashSessionWhereInput = {
    operationalDayId: day.id,
    OR: [
      { status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] } },
      { status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW, requiresReview: true },
    ],
  };
  // Pagos pendientes del día: por operationalDayId (no por ventana).
  const pendingBaseWhere: Prisma.SaleOrderWhereInput = { operationalDayId: day.id, status: SaleOrderStatus.PENDING_PAYMENT };
  const creditFilter: Prisma.SaleOrderWhereInput = { customer: { creditProfiles: { some: { isActive: true } } } };

  const [
    pendingReturnCount,
    pendingReturnRefs,
    pendingCancellationCount,
    pendingCancellationRefs,
    pendingTransportCount,
    pendingTransportRefs,
    openSessionCount,
    openOrUnreviewedSessionRefs,
    pendingPaymentTotalCount,
    creditPendingCount,
    pendingPaymentSample,
  ] = await Promise.all([
    tx.saleReturn.count({ where: returnWhere }),
    tx.saleReturn.findMany({
      where: returnWhere,
      select: { id: true, returnNumber: true, status: true, createdAt: true },
      take: BLOCKER_SAMPLE_LIMIT,
    }),
    tx.saleCancellation.count({ where: cancellationWhere }),
    tx.saleCancellation.findMany({
      where: cancellationWhere,
      select: { id: true, saleOrderId: true, status: true, createdAt: true },
      take: BLOCKER_SAMPLE_LIMIT,
    }),
    tx.transportService.count({ where: transportWhere }),
    tx.transportService.findMany({
      where: transportWhere,
      select: { id: true, status: true, createdAt: true },
      take: BLOCKER_SAMPLE_LIMIT,
    }),
    tx.cashSession.count({ where: sessionWhere }),
    tx.cashSession.findMany({
      where: sessionWhere,
      select: { id: true, status: true, openedAt: true, physicalCashBox: { select: { code: true } } },
      take: BLOCKER_SAMPLE_LIMIT,
    }),
    tx.saleOrder.count({ where: pendingBaseWhere }),
    tx.saleOrder.count({ where: { ...pendingBaseWhere, ...creditFilter } }),
    tx.saleOrder.findMany({
      where: pendingBaseWhere,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        createdAt: true,
        customerId: true,
        customer: {
          select: {
            creditProfiles: { where: { isActive: true }, select: { id: true }, take: 1 },
          },
        },
      },
      take: BLOCKER_SAMPLE_LIMIT,
    }),
  ]);

  // Crédito legítimo: PENDING_PAYMENT con perfil de crédito activo = cuenta por
  // cobrar a crédito (warning, no bloquea). El resto = ventas de contado sin cobrar.
  const cashPendingCount = Math.max(0, pendingPaymentTotalCount - creditPendingCount);
  const cashSample = pendingPaymentSample.filter((o) => !o.customer?.creditProfiles?.length);
  const creditSample = pendingPaymentSample.filter((o) => (o.customer?.creditProfiles?.length ?? 0) > 0);

  const blockers: OperationalDayBlocker[] = [];
  const warnings: OperationalDayBlocker[] = [];

  const mk = (
    code: string,
    label: string,
    count: number,
    references: OperationalDayBlocker["references"],
  ): OperationalDayBlocker => ({
    code,
    label,
    count,
    references,
    sampleLimit: BLOCKER_SAMPLE_LIMIT,
    hasMore: count > references.length,
  });

  if (pendingReturnCount > 0) {
    blockers.push(mk(
      "PENDING_SALE_RETURN",
      "Hay devoluciones pendientes de ejecutar en este día",
      pendingReturnCount,
      pendingReturnRefs.map((r) => ({
        id: r.id,
        ref: r.returnNumber,
        status: r.status,
        date: r.createdAt.toISOString(),
        resolve: { kind: "SALE_RETURN", href: "/app/master/sales/orders", entityId: r.id },
      })),
    ));
  }
  if (pendingCancellationCount > 0) {
    blockers.push(mk(
      "PENDING_SALE_CANCELLATION",
      "Hay anulaciones pendientes de ejecutar en este día",
      pendingCancellationCount,
      pendingCancellationRefs.map((r) => ({
        id: r.id,
        ref: r.saleOrderId,
        status: r.status,
        date: r.createdAt.toISOString(),
        resolve: { kind: "SALE_CANCELLATION", href: "/app/master/sales/orders", entityId: r.saleOrderId },
      })),
    ));
  }
  if (pendingTransportCount > 0) {
    blockers.push(mk(
      "PENDING_TRANSPORT",
      "Hay transportes del día pendientes o en tránsito",
      pendingTransportCount,
      pendingTransportRefs.map((r) => ({
        id: r.id,
        status: r.status,
        date: r.createdAt.toISOString(),
        resolve: { kind: "TRANSPORT", href: "/app/branch/dispatch", entityId: r.id },
      })),
    ));
  }
  if (openSessionCount > 0) {
    blockers.push(mk(
      "OPEN_OR_UNREVIEWED_CASH_SESSION",
      "Hay cajas abiertas o pendientes de revisión en este día",
      openSessionCount,
      openOrUnreviewedSessionRefs.map((r) => ({
        id: r.id,
        ref: r.physicalCashBox?.code,
        status: r.status,
        date: r.openedAt.toISOString(),
        resolve: { kind: "CASH_SESSION", href: "/app/branch/cashier", entityId: r.id },
      })),
    ));
  }
  if (cashPendingCount > 0) {
    blockers.push(mk(
      "PENDING_PAYMENT_ORDER",
      "Hay órdenes del día sin cobrar (PENDING_PAYMENT)",
      cashPendingCount,
      cashSample.map((r) => ({
        id: r.id,
        ref: r.orderNumber,
        status: r.status,
        date: r.createdAt.toISOString(),
        resolve: { kind: "SALE_ORDER", href: "/app/master/sales/orders", entityId: r.id },
      })),
    ));
  }
  if (creditPendingCount > 0) {
    warnings.push(mk(
      "OPEN_CREDIT_RECEIVABLE",
      "Hay ventas a crédito pendientes de pago (no bloquean la aprobación)",
      creditPendingCount,
      creditSample.map((r) => ({
        id: r.id,
        ref: r.orderNumber,
        status: r.status,
        date: r.createdAt.toISOString(),
        resolve: { kind: "SALE_ORDER", href: "/app/master/sales/orders", entityId: r.id },
      })),
    ));
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

/**
 * Compara el summary recalculado contra el snapshot inmutable del cierre
 * (closeSummaryJson). Devuelve las diferencias por campo, warnings legibles y si
 * hay alguna diferencia material (> C$0.01).
 */
function computeApprovalReconciliation(
  summary: {
    salesTotal: number;
    paidOrdersTotal: number;
    pendingPaymentTotal: number;
    cashDifferenceTotal: number;
    countedCashTotal: number;
  },
  closeSummary: Record<string, number> | null,
): { diffs: Record<string, number> | null; warnings: string[]; material: boolean } {
  if (!closeSummary) return { diffs: null, warnings: [], material: false };
  const fields = [
    "salesTotal",
    "paidOrdersTotal",
    "pendingPaymentTotal",
    "cashDifferenceTotal",
    "countedCashTotal",
  ] as const;
  const diffs: Record<string, number> = {};
  const warnings: string[] = [];
  let material = false;
  for (const f of fields) {
    const cur = n(summary[f]);
    const prev = n(closeSummary[f] ?? 0);
    const d = cur - prev;
    diffs[f] = d;
    if (Math.abs(d) > 0.01) {
      material = true;
      warnings.push(`${f}: cierre=${prev.toFixed(2)} → aprobación=${cur.toFixed(2)} (Δ ${d.toFixed(2)})`);
    }
  }
  return { diffs, warnings, material };
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

    // F: recalcular summary ANTES de aprobar (nunca usar los totales viejos).
    const summary = await calculateOperationalSummaryTx(tx, day);

    const { blockers: blockerList, warnings: warningList } = await computeApprovalBlockers(tx, day);

    // F: comparar el summary recalculado contra el snapshot inmutable del cierre.
    // Diferencias materiales (p.ej. una venta offline tardía entró tras el cierre)
    // se reportan como warnings de reconciliación.
    const closeSummary = day.closeSummaryJson as Record<string, number> | null;
    const reconciliation = computeApprovalReconciliation(summary, closeSummary);
    const delta = reconciliation.diffs;

    // F.7: no aprobar si la fuente es MIXED y hay diferencias materiales contra el
    // cierre, salvo override Master explícito con nota.
    const criticalReconciliation = summary.sourceMode === "MIXED" && reconciliation.material;
    if (criticalReconciliation && !(input.forceApprove && input.isMaster && input.note?.trim())) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: day.branchId,
          module: "operations",
          action: "OPERATIONAL_DAY_APPROVE_RECONCILIATION_REQUIRED",
          entityType: "OperationalDay",
          entityId: day.id,
          metadataJson: toJsonValue({ sourceMode: summary.sourceMode, reconciliation, warnings: warningList }),
        },
      });
      const err = new Error("OPERATIONAL_DAY_APPROVE_REQUIRES_RECONCILIATION");
      (err as unknown as { reconciliation: typeof reconciliation }).reconciliation = reconciliation;
      throw err;
    }

    // G/F: no aprobar un día con ventas offline sincronizadas tras el cierre
    // (pendientes de revisión) salvo override Master explícito con nota.
    if (summary.lateOfflineSyncCount > 0 && !(input.forceApprove && input.isMaster && input.note?.trim())) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: day.branchId,
          module: "operations",
          action: "OPERATIONAL_DAY_APPROVE_LATE_OFFLINE_PENDING",
          entityType: "OperationalDay",
          entityId: day.id,
          metadataJson: toJsonValue({ lateOfflineSyncCount: summary.lateOfflineSyncCount }),
        },
      });
      const err = new Error("OPERATIONAL_DAY_APPROVE_LATE_OFFLINE_PENDING");
      (err as unknown as { lateOfflineSyncCount: number }).lateOfflineSyncCount = summary.lateOfflineSyncCount;
      throw err;
    }

    const approveData = {
      approvedByMasterId: input.actorUserId,
      approvedAt: new Date(),
      summaryJson: toJsonValue(summary),
      // Immutable approval snapshot — incluye la reconciliación contra el cierre.
      approvalSummaryJson: toJsonValue({
        ...summary,
        reconciliation: reconciliation.diffs,
        reconciliationWarnings: reconciliation.warnings,
        reconciledAgainstClose: Boolean(closeSummary),
      }),
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
        const exceptionFingerprint = `operations:approve-exception:${day.id}:${blocker.code}`;
        const existingExceptionDecision = await tx.brainDecision.findUnique({
          where: { fingerprint: exceptionFingerprint },
          select: { status: true },
        });
        await tx.brainDecision.upsert({
          where: { fingerprint: exceptionFingerprint },
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
            fingerprint: exceptionFingerprint,
            idempotencyKey: `brain:operations:approve-exception:${day.id}:${blocker.code}`,
          },
          update: {
            evidenceJson: toJsonValue({ operationalDayId: day.id, blocker, note: input.note }),
            // No se reabre si Master ya la descartó explícitamente.
            ...(existingExceptionDecision?.status === "DISMISSED" ? {} : { status: "OPEN" }),
          },
        });
      }

      // Master ya revisó y aceptó el cierre (con excepción) — la advertencia
      // de "cerrado con advertencias" deja de estar pendiente.
      await resolveClosedWithWarningsDecisionTx(tx, day.id, input.actorUserId);

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

    // Master ya revisó y aceptó el cierre — la advertencia de "cerrado con
    // advertencias" (si la hubo) deja de estar pendiente.
    await resolveClosedWithWarningsDecisionTx(tx, day.id, input.actorUserId);

    return approved;
  });
}

export async function cancelOperationalDay(input: { id: string; actorUserId: string; note: string; override?: boolean }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${input.id} FOR UPDATE`;
    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });

    // Un día aprobado NUNCA se cancela (ni con override): su snapshot es definitivo.
    if (day.approvedAt) throw new Error("OPERATIONAL_DAY_ALREADY_APPROVED");
    if (day.status === OperationalDayStatus.CANCELLED) throw new Error("OPERATIONAL_DAY_ALREADY_CANCELLED");
    if (day.status === OperationalDayStatus.CLOSING) throw new Error("OPERATIONAL_DAY_CLOSING_IN_PROGRESS");

    // Actividad real del día (por operationalDayId; transportes/despachos por ventana
    // como fallback hasta que tengan el id poblado). Si existe, no se cancela salvo override.
    const { start, end } = operationalWindow(day.businessDate);
    const [
      postedPayments,
      executedReturns,
      executedCancellations,
      executedDispatches,
      executedTransports,
      cashMovementsCount,
      closedCashSessions,
    ] = await Promise.all([
      tx.payment.count({ where: { operationalDayId: day.id, status: PaymentStatus.POSTED } }),
      tx.saleReturn.count({ where: { operationalDayId: day.id, executedAt: { not: null } } }),
      tx.saleCancellation.count({ where: { operationalDayId: day.id, executedAt: { not: null } } }),
      tx.dispatchTicket.count({ where: { branchId: day.branchId, status: "DISPATCHED", createdAt: { gte: start, lt: end } } }),
      tx.transportService.count({ where: { branchId: day.branchId, status: "DELIVERED", createdAt: { gte: start, lt: end } } }),
      tx.cashMovement.count({ where: { cashSession: { operationalDayId: day.id } } }),
      tx.cashSession.count({ where: { operationalDayId: day.id, status: CashSessionStatus.CLOSED } }),
    ]);

    const cancelChecklist = {
      postedPayments,
      executedReturns,
      executedCancellations,
      executedDispatches,
      executedTransports,
      cashMovements: cashMovementsCount,
      closedCashSessions,
    };
    const hasRealActivity =
      postedPayments > 0 ||
      executedReturns > 0 ||
      executedCancellations > 0 ||
      executedDispatches > 0 ||
      executedTransports > 0 ||
      cashMovementsCount > 0;

    if (hasRealActivity && !input.override) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: day.branchId,
          module: "operations",
          action: "OPERATIONAL_DAY_CANCEL_BLOCKED",
          entityType: "OperationalDay",
          entityId: day.id,
          metadataJson: toJsonValue({ checklist: cancelChecklist, note: input.note }),
        },
      });
      const err = new Error("OPERATIONAL_DAY_HAS_REAL_ACTIVITY");
      (err as unknown as { checklist: typeof cancelChecklist }).checklist = cancelChecklist;
      throw err;
    }

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
        metadataJson: toJsonValue({ note: input.note, override: Boolean(input.override), checklist: cancelChecklist }),
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

export type PendingCloseDayRow = {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  businessDate: string;
  daysOverdue: number;
  salesTotal: number;
  expectedCashTotal: number;
  blockers: {
    autoClosedPendingReviewCount: number;
    openOrReconcilingCashSessionsCount: number;
  };
};

/**
 * Día Operativo v2 Fase 5.5 — la cola de días que pasaron su fecha sin
 * cerrarse (PENDING_CLOSE), del más viejo al más nuevo. Ninguno bloquea la
 * operación de hoy; ninguno caduca ni se borra — esperan a que un humano los
 * concilie y cierre (closeOperationalDay ya acepta PENDING_CLOSE, ver 5.4).
 */
export async function listPendingCloseDays(): Promise<PendingCloseDayRow[]> {
  const days = await prisma.operationalDay.findMany({
    where: { status: OperationalDayStatus.PENDING_CLOSE },
    include: { branch: { select: { id: true, code: true, name: true } } },
    orderBy: { businessDate: "asc" },
    take: 100,
  });

  const today = businessDateFromNow();
  const rows: PendingCloseDayRow[] = [];
  for (const day of days) {
    const [summary, autoClosedPendingReviewCount, openOrReconcilingCashSessionsCount] = await Promise.all([
      prisma.$transaction((tx) => calculateOperationalSummaryTx(tx, day)),
      prisma.cashSession.count({
        where: { operationalDayId: day.id, status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW, requiresReview: true },
      }),
      prisma.cashSession.count({
        where: { operationalDayId: day.id, status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] } },
      }),
    ]);
    const daysOverdue = Math.round((today.getTime() - day.businessDate.getTime()) / (24 * 60 * 60 * 1000));
    rows.push({
      id: day.id,
      branchId: day.branchId,
      branchCode: day.branch.code,
      branchName: day.branch.name,
      businessDate: day.businessDate.toISOString(),
      daysOverdue,
      salesTotal: summary.salesTotal,
      expectedCashTotal: summary.expectedCashTotal,
      blockers: { autoClosedPendingReviewCount, openOrReconcilingCashSessionsCount },
    });
  }
  return rows;
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

  // Híbrido (operacional): por operationalDayId, o legacy sin id dentro de la ventana.
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
    // (1) Operaciones por operationalDayId (híbrido con legacy)
    orders,
    paymentsByMethod,
    dispatches,
    returns,
    cancellations,
    transports,
    // (2) Actividad cronológica por ventana Managua (vista temporal pura)
    chronoOrders,
    chronoPaymentsByMethod,
    // (3) Legacy fallback: filas en la ventana SIN operationalDayId (no migradas)
    legacyOrdersCount,
    legacyPaymentsCount,
    // Brain + auditoría
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

  // Día Operativo v2 Fase 4 — el reporte de un día ya CLOSED es el que se
  // firmó: lee el snapshot inmutable (closeSummaryJson), nunca recalcula. Un
  // día todavía OPEN/PENDING_CLOSE/CLOSING/REOPENED_FOR_ADJUSTMENT no tiene
  // (o ya no es) snapshot definitivo — se calcula en vivo, marcado como tal.
  let summary: Record<string, unknown>;
  let summarySource: "SNAPSHOT" | "LIVE";
  if (day.status === OperationalDayStatus.CLOSED && day.closeSummaryJson) {
    summary = day.closeSummaryJson as Record<string, unknown>;
    summarySource = "SNAPSHOT";
  } else {
    summary = await prisma.$transaction((tx) => calculateOperationalSummaryTx(tx, day));
    summarySource = "LIVE";
  }

  // La actividad que entró DESPUÉS del cierre (ventas offline sincronizadas
  // tarde) se muestra aparte, con referencia — nunca se suma al número
  // firmado. El sistema ya la CONTABA (lateOfflineSyncCount); acá se expone
  // el detalle.
  const lateActivityOrders = day.closedAt
    ? await prisma.saleOrder.findMany({
        where: { operationalDayId: day.id, offlineClientId: { not: null }, syncedAt: { gt: day.closedAt } },
        select: { id: true, orderNumber: true, grandTotal: true, syncedAt: true, createdAt: true },
        orderBy: { syncedAt: "asc" },
        take: 100,
      })
    : [];

  return {
    day,
    // Vista primaria (back-compat): operaciones del día (híbrido id/legacy).
    orders,
    paymentsByMethod,
    dispatches,
    brain,
    audit,
    window: { start, end, timezone: TIMEZONE },
    // Fase 4: número firmado (snapshot) para un día CLOSED; en vivo si no.
    summary,
    summarySource,
    lateActivity: { orders: lateActivityOrders, count: lateActivityOrders.length },
    // (1) Operaciones por operationalDayId — la fuente de verdad.
    operations: { orders, paymentsByMethod, dispatches, returns, cancellations, transports },
    // (2) Actividad cronológica por ventana Managua (para contraste temporal).
    chronological: { orders: chronoOrders, paymentsByMethod: chronoPaymentsByMethod, window: { start, end, timezone: TIMEZONE } },
    // (3) Legacy fallback — filas en la ventana sin operationalDayId (pendientes de backfill).
    legacyFallback: { ordersWithoutOperationalDay: legacyOrdersCount, paymentsWithoutOperationalDay: legacyPaymentsCount },
  };
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
  | "STALE_OPEN_DAY"
  | "PENDING_CLOSE";

export function deriveOperationalDayState(
  day: { status: string; businessDate: Date; approvedAt: Date | null } | null,
): OperationalDayDerivedState {
  if (!day) return "NOT_OPENED_TODAY";
  const today = businessDateFromNow();
  if (day.status === "OPEN") {
    // Fase 5: en operación normal esto ya no debería pasar (un OPEN de fecha
    // pasada se barre a PENDING_CLOSE) — se conserva como diagnóstico
    // defensivo para la breve ventana antes de que corra el barrido.
    return day.businessDate.getTime() === today.getTime() ? "OPEN_TODAY" : "STALE_OPEN_DAY";
  }
  if (day.status === "PENDING_CLOSE") return "PENDING_CLOSE";
  if (day.status === "CLOSING") return "CLOSING";
  if (day.status === "CLOSED") return day.approvedAt ? "APPROVED_ARCHIVED" : "CLOSED_PENDING_MASTER";
  if (day.status === "REOPENED_FOR_ADJUSTMENT") return "CLOSED_PENDING_MASTER";
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
  /** Fase 5.5: cuántos días esperan en la cola de Pendientes de cierre — para el aviso persistente al Master. Nunca bloquea la operación de hoy. */
  pendingCloseDaysCount: number;
}> {
  const today = businessDateFromNow();
  const { start, end } = operationalWindow(today);
  const pendingCloseDaysCount = await prisma.operationalDay.count({ where: { status: OperationalDayStatus.PENDING_CLOSE } });

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
    pendingCloseDaysCount,
  };
}

// ── Reopen operational day ────────────────────────────────────────────────────

export async function reopenOperationalDay(input: { id: string; actorUserId: string; note: string }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${input.id} FOR UPDATE`;

    const day = await tx.operationalDay.findUniqueOrThrow({ where: { id: input.id } });

    if (day.status !== OperationalDayStatus.CLOSED) throw new Error("OPERATIONAL_DAY_NOT_CLOSED");

    // J: nota SIEMPRE obligatoria (no solo si estaba aprobado).
    if (!input.note?.trim()) throw new Error("OPERATIONAL_DAY_REOPEN_NOTE_REQUIRED");

    // J: no reabrir si la sucursal ya tiene otro día ACTIVO (OPEN/CLOSING/REOPENED_FOR_ADJUSTMENT).
    // Dos días activos romperían el invariante de "un solo día operativo en curso".
    const otherActive = await tx.operationalDay.findFirst({
      where: {
        branchId: day.branchId,
        id: { not: day.id },
        status: { in: [OperationalDayStatus.OPEN, OperationalDayStatus.CLOSING, OperationalDayStatus.REOPENED_FOR_ADJUSTMENT] },
      },
      select: { id: true, businessDate: true, status: true },
    });
    if (otherActive) {
      const err = new Error("OPERATIONAL_DAY_REOPEN_BLOCKED_ACTIVE_DAY_EXISTS");
      (err as unknown as { activeDay: typeof otherActive }).activeDay = otherActive;
      throw err;
    }

    // J: decidir el estado destino.
    //  - Si es el día de HOY → OPEN (se reanuda la operación normal).
    //  - Si es un día PASADO → REOPENED_FOR_ADJUSTMENT (ajuste Master controlado,
    //    NO operación normal: las ventas nuevas exigen OPEN, así que no se crean
    //    ventas en un día pasado solo por reabrirlo). Se conserva closeSummaryJson
    //    como histórico; se limpia la aprobación para exigir re-aprobación.
    const today = businessDateFromNow();
    const isToday = day.businessDate.getTime() === today.getTime();
    const targetStatus = isToday ? OperationalDayStatus.OPEN : OperationalDayStatus.REOPENED_FOR_ADJUSTMENT;

    const reopened = await tx.operationalDay.update({
      where: { id: input.id },
      data: {
        status: targetStatus,
        // Solo se reanuda como operación (limpia cierre) cuando vuelve a OPEN hoy.
        closedAt: isToday ? null : day.closedAt,
        closedByUserId: isToday ? null : day.closedByUserId,
        approvedAt: null,
        approvedByMasterId: null,
        notes: input.note,
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
          targetStatus,
          isToday,
          wasApproved: !!day.approvedAt,
          // J: conservar los snapshots previos en la auditoría antes de sobrescribir la aprobación.
          previousApprovedAt: day.approvedAt,
          previousApprovedByMasterId: day.approvedByMasterId,
          previousCloseSummaryJson: day.closeSummaryJson ?? null,
          previousApprovalSummaryJson: day.approvalSummaryJson ?? null,
        }),
      },
    });

    return reopened;
  });
}
