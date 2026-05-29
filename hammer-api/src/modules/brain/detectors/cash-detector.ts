import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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

  const [closures, discountedOrders, payments] = await Promise.all([
    prisma.cashClosure.findMany({
      where: {
        closedAt: { gte: ctx.since },
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
        OR: [{ isReopened: true }, { reopenCount: { gt: 0 } }, { emergencySalesCount: { gt: 0 } }],
      },
      include: { branch: { select: { id: true, code: true, name: true } } },
      take: 100,
      orderBy: { closedAt: "desc" },
    }),
    prisma.saleOrder.findMany({
      where: {
        createdAt: { gte: ctx.since },
        discountTotal: { gt: 0 },
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, username: true, fullName: true } },
      },
      take: 500,
      orderBy: { createdAt: "desc" },
    }),
    prisma.payment.findMany({
      where: {
        createdAt: { gte: ctx.since },
        status: "POSTED",
        saleOrder: ctx.branchId ? { branchId: ctx.branchId } : undefined,
      },
      select: { saleOrderId: true },
      take: 1000,
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
