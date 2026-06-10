import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateExpectedCashForSessionTx } from "@/modules/cash-session/service";
import { riskScoreFor } from "@/modules/brain/scoring";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";

function n(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

function formatActor(user: { fullName?: string | null; username?: string | null } | null | undefined) {
  if (!user) return "Usuario";
  const fullName = user.fullName?.trim();
  const username = user.username?.trim();
  if (fullName && username) return `${fullName} (usuario: ${username})`;
  return fullName || username || "Usuario";
}

export async function detectCashDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];

  const [closures, discountedOrders, payments, scopedCashSessions] = await Promise.all([
    ctx.mode === "DEEP_SCAN" || ctx.mode === "REPAIR_SCAN" ? prisma.cashClosure.findMany({
      where: {
        closedAt: { gte: ctx.dateFrom, lt: ctx.dateTo },
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
        OR: [{ isReopened: true }, { reopenCount: { gt: 0 } }, { emergencySalesCount: { gt: 0 } }],
      },
      include: { branch: { select: { id: true, code: true, name: true } } },
      take: Math.min(100, ctx.limits.maxEntities),
      orderBy: { closedAt: "desc" },
    }) : Promise.resolve([]),
    prisma.saleOrder.findMany({
      where: {
        payments: { some: { paidAt: { gte: ctx.dateFrom, lt: ctx.dateTo } } },
        discountTotal: { gt: 0 },
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, username: true, fullName: true } },
      },
      take: Math.min(500, ctx.limits.maxEntities),
      orderBy: { createdAt: "desc" },
    }),
    prisma.payment.findMany({
      where: {
        paidAt: { gte: ctx.dateFrom, lt: ctx.dateTo },
        status: "POSTED",
        saleOrder: ctx.branchId ? { branchId: ctx.branchId } : undefined,
      },
      select: { saleOrderId: true },
      take: Math.min(1000, ctx.limits.maxEntities),
    }),
    prisma.cashSession.findMany({
      where: {
        ...(ctx.cashSessionId ? { id: ctx.cashSessionId } : {}),
        ...(ctx.operationalDayId ? { operationalDayId: ctx.operationalDayId } : {}),
        ...(ctx.branchId ? { physicalCashBox: { branchId: ctx.branchId } } : {}),
        openedAt: ctx.cashSessionId || ctx.operationalDayId ? undefined : { lt: ctx.dateTo },
        OR: ctx.cashSessionId || ctx.operationalDayId ? undefined : [
          { closedAt: null },
          { closedAt: { gte: ctx.dateFrom } },
          { autoClosedAt: { gte: ctx.dateFrom } },
        ],
      },
      include: {
        physicalCashBox: { include: { branch: { select: { id: true, code: true, name: true } } } },
        openedBy: { select: { id: true, username: true, fullName: true } },
      },
      take: Math.min(200, ctx.limits.maxEntities),
      orderBy: { openedAt: "desc" },
    }),
  ]);

  const autoClosedSessions = await prisma.cashSession.findMany({
    where: {
      status: "AUTO_CLOSED_PENDING_REVIEW",
      requiresReview: true,
      ...(ctx.branchId ? { physicalCashBox: { branchId: ctx.branchId } } : {}),
    },
    include: {
      physicalCashBox: { include: { branch: { select: { id: true, code: true, name: true } } } },
      openedBy: { select: { id: true, username: true, fullName: true } },
    },
    take: 100,
    orderBy: { autoClosedAt: "asc" },
  });

  for (const session of autoClosedSessions) {
    const hoursPending = session.autoClosedAt ? Math.round((ctx.now.getTime() - session.autoClosedAt.getTime()) / 36e5) : 0;
    const severity = hoursPending >= 12 ? "CRITICAL" : "HIGH";
    decisions.push({
      category: "CASH",
      severity,
      title: `Caja cerrada automaticamente pendiente de revision: ${session.physicalCashBox.code}`,
      description: `${session.physicalCashBox.branch.code} requiere conteo fisico y revision del cierre automatico.`,
      recommendation: "Revisar cierre de caja e ingresar monto contado. No asumir caja cuadrada sin conteo humano.",
      branchId: session.physicalCashBox.branchId,
      targetUserId: session.openedByUserId,
      confidenceScore: 98,
      impactAmount: n(session.expectedCashAmount),
      riskScore: riskScoreFor(severity, 98),
      proposedActionType: "REVIEW_CASH_SESSION",
      proposedActionJson: { cashSessionId: session.id },
      evidenceJson: {
        cashSessionId: session.id,
        physicalCashBoxId: session.physicalCashBoxId,
        openedAt: session.openedAt,
        autoClosedAt: session.autoClosedAt,
        expectedCashAmount: n(session.expectedCashAmount),
        hoursPending,
        openedBy: formatActor(session.openedBy),
      },
      sourceJson: { detector: "cash-detector", cashSessionId: session.id },
      fingerprintParts: ["cash", "auto-closed-pending-review", session.id],
    });
  }

  for (const session of scopedCashSessions) {
    const snapshot = await prisma.$transaction((tx) => calculateExpectedCashForSessionTx(tx, session.id, session.openingAmount));
    const storedExpected = session.expectedCashAmount == null ? null : n(session.expectedCashAmount);
    const mismatch = storedExpected !== null && Math.abs(storedExpected - snapshot.expectedCash) >= 0.01;
    if (!mismatch) continue;

    decisions.push({
      category: "CASH",
      severity: Math.abs((storedExpected ?? 0) - snapshot.expectedCash) > 1000 ? "CRITICAL" : "HIGH",
      title: `Snapshot de caja desactualizado: ${session.physicalCashBox.code}`,
      description: `${session.physicalCashBox.branch.code} guarda esperado C$${storedExpected?.toFixed(2) ?? "0.00"}, pero PaymentTender + movimientos calculan C$${snapshot.expectedCash.toFixed(2)}.`,
      recommendation: "Recalcular la caja desde PaymentTender POSTED y CashMovement antes de cerrar Dia Operativo.",
      branchId: session.physicalCashBox.branchId,
      targetUserId: session.openedByUserId,
      confidenceScore: 98,
      impactAmount: Math.abs((storedExpected ?? 0) - snapshot.expectedCash),
      riskScore: riskScoreFor(Math.abs((storedExpected ?? 0) - snapshot.expectedCash) > 1000 ? "CRITICAL" : "HIGH", 98),
      proposedActionType: "RECALCULATE_CASH_SESSION",
      proposedActionJson: {
        type: "RECALCULATE_CASH_SESSION",
        dryRunSupported: true,
        requiresApproval: false,
        target: { entityType: "CashSession", entityId: session.id },
        expectedEffect: "Actualizar expectedCashAmount/differenceAmount desde tenders y movimientos.",
        cashSessionId: session.id,
      },
      evidenceJson: {
        detector: "CASH_SESSION_INTEGRITY_DETECTOR",
        rootCause: "CashSession.expectedCashAmount no coincide con el snapshot tecnico calculado desde PaymentTender POSTED y CashMovement.",
        diagnosis: "Caja con snapshot viejo o descuadrado.",
        cashSessionId: session.id,
        storedExpectedCashAmount: storedExpected,
        computedExpectedCashAmount: snapshot.expectedCash,
        openingAmount: snapshot.openingAmount,
        postedCashPayments: snapshot.postedCashPayments,
        cashMovementsNet: snapshot.cashMovementsNet,
        cashChange: snapshot.cashChange,
        blocksOperationalDayClose: true,
        actionPlan: "RECALCULATE_CASH_SESSION",
      },
      sourceJson: { detector: "cash-detector", mode: ctx.mode, scope: ctx.scope, problemCode: "CASH_SESSION_EXPECTED_MISMATCH" },
      fingerprintParts: ["brain", "CASH_SESSION_INTEGRITY_DETECTOR", session.physicalCashBox.branchId, ctx.businessDate ?? "range", "CashSession", session.id, "CASH_SESSION_EXPECTED_MISMATCH"],
    });
  }

  for (const closure of closures) {
    const severity = closure.emergencySalesCount > closure.maxEmergencySales || closure.reopenCount > 1 ? "HIGH" : "MEDIUM";
    decisions.push({
      category: "CASH",
      severity,
      title: `Cierre de caja reabierto: ${closure.branch.code}`,
      description: `${closure.branch.name} tuvo ${closure.reopenCount} reaperturas y ${closure.emergencySalesCount} ventas de emergencia.`,
      recommendation: "Revisar autorizaciones, ventas posteriores al cierre y bitacora de caja.",
      branchId: closure.branchId,
      confidenceScore: 0.84,
      riskScore: riskScoreFor(severity, 0.84),
      proposedActionType: "REVIEW_CASH_CLOSURE",
      proposedActionJson: { cashClosureId: closure.id },
      evidenceJson: {
        closureDate: closure.closureDate.toISOString(),
        reopenCount: closure.reopenCount,
        emergencySalesCount: closure.emergencySalesCount,
        transactionCount: closure.transactionCount,
        totalSales: n(closure.totalSales),
      },
      sourceJson: { detector: "cash-detector", cashClosureId: closure.id },
      fingerprintParts: ["cash", "reopened-closure", closure.id],
    });
  }

  const discountsByUser = new Map<string, { userId: string; actorLabel: string; branchId: string; branchCode: string; count: number; total: number }>();
  for (const order of discountedOrders) {
    const key = `${order.createdByUserId}:${order.branchId}`;
    const current = discountsByUser.get(key) ?? {
      userId: order.createdByUserId,
      actorLabel: formatActor(order.createdBy),
      branchId: order.branchId,
      branchCode: order.branch.code,
      count: 0,
      total: 0,
    };
    current.count++;
    current.total += n(order.discountTotal);
    discountsByUser.set(key, current);
  }

  for (const row of discountsByUser.values()) {
    if (row.count < 5 && row.total < 1000) continue;
    decisions.push({
      category: "CASH",
      severity: row.total > 5000 ? "HIGH" : "MEDIUM",
      title: `Descuentos elevados por usuario: ${row.actorLabel}`,
      description: `${row.branchCode} registra ${row.count} ordenes con descuento por C$${row.total.toFixed(2)} en ${ctx.days} dias.`,
      recommendation: "Revisar politicas de descuento, autorizaciones y patrones por cajero/vendedor.",
      branchId: row.branchId,
      userId: row.userId,
      confidenceScore: 0.74,
      impactAmount: row.total,
      riskScore: riskScoreFor(row.total > 5000 ? "HIGH" : "MEDIUM", 0.74),
      proposedActionType: "REVIEW_USER_DISCOUNTS",
      evidenceJson: { user: row.actorLabel, discountedOrders: row.count, totalDiscount: row.total },
      sourceJson: { detector: "cash-detector" },
      fingerprintParts: ["cash", "discounts-by-user", row.branchId, row.userId],
    });
  }

  const paymentsByOrder = new Map<string, number>();
  for (const payment of payments) {
    paymentsByOrder.set(payment.saleOrderId, (paymentsByOrder.get(payment.saleOrderId) ?? 0) + 1);
  }

  for (const [saleOrderId, count] of paymentsByOrder) {
    if (count <= 1) continue;
    decisions.push({
      category: "CASH",
      severity: "HIGH",
      title: "Posible pago duplicado",
      description: `La orden ${saleOrderId} tiene ${count} pagos posteados.`,
      recommendation: "Validar si fue pago mixto esperado o duplicacion de transaccion.",
      confidenceScore: 0.7,
      riskScore: riskScoreFor("HIGH", 0.7),
      proposedActionType: "REVIEW_PAYMENT_DUPLICATE",
      evidenceJson: { saleOrderId, postedPayments: count },
      sourceJson: { detector: "cash-detector" },
      fingerprintParts: ["cash", "duplicate-payments", saleOrderId],
    });
  }

  return decisions;
}
