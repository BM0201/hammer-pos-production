import { CashSessionStatus, PaymentMethod, Prisma, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

const NICARAGUA_TZ = "America/Managua";
const AUTO_CLOSE_HOUR = 17; // 5 PM
const AUTO_CLOSE_MINUTE = 30; // 5:30 PM

/* ── Helpers ── */

function getNicaraguaDate(date?: Date): Date {
  const d = date ?? new Date();
  const niFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: NICARAGUA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = niFormatter.format(d);
  return new Date(parts + "T00:00:00.000Z");
}

function getNicaraguaTime(date?: Date): { hours: number; minutes: number } {
  const d = date ?? new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: NICARAGUA_TZ,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const hours = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minutes = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hours, minutes };
}

export function isAfterAutoCloseTime(date?: Date): boolean {
  const { hours, minutes } = getNicaraguaTime(date);
  return hours > AUTO_CLOSE_HOUR || (hours === AUTO_CLOSE_HOUR && minutes >= AUTO_CLOSE_MINUTE);
}

/* ── Get today's closure for a branch ── */

export async function getTodayClosure(branchId: string): Promise<{
  closure: Awaited<ReturnType<typeof prisma.cashClosure.findFirst>>;
  isClosed: boolean;
  canSell: boolean;
}> {
  const today = getNicaraguaDate();
  const closure = await prisma.cashClosure.findFirst({
    where: { branchId, closureDate: today },
  });

  if (!closure) {
    return { closure: null, isClosed: false, canSell: true };
  }

  if (closure.isPermanentlyClosed) {
    return { closure, isClosed: true, canSell: false };
  }

  if (closure.isReopened && closure.emergencySalesCount < closure.maxEmergencySales) {
    return { closure, isClosed: false, canSell: true };
  }

  if (closure.isReopened && closure.emergencySalesCount >= closure.maxEmergencySales) {
    return { closure, isClosed: true, canSell: false };
  }

  return { closure, isClosed: true, canSell: false };
}

/* ── Execute automatic closure for a single branch ── */

export async function executeAutoClosure(branchId: string): Promise<{ closureId: string; alreadyClosed: boolean }> {
  const today = getNicaraguaDate();

  // Check if already closed today
  const existing = await prisma.cashClosure.findFirst({
    where: { branchId, closureDate: today },
  });

  if (existing) {
    return { closureId: existing.id, alreadyClosed: true };
  }

  // Calculate today's sales data
  const todayStart = today;
  const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  const payments = await prisma.payment.findMany({
    where: {
      saleOrder: { branchId },
      paidAt: { gte: todayStart, lt: todayEnd },
      status: "POSTED",
    },
    include: {
      saleOrder: {
        include: { lines: true },
      },
    },
  });

  const totalSales = payments.reduce((acc, p) => acc.plus(p.amount), new Prisma.Decimal(0));
  const transactionCount = payments.length;

  const methodTotals: Record<string, Prisma.Decimal> = {
    CASH: new Prisma.Decimal(0),
    CARD: new Prisma.Decimal(0),
    TRANSFER: new Prisma.Decimal(0),
    CREDIT: new Prisma.Decimal(0),
    MIXED: new Prisma.Decimal(0),
  };

  for (const p of payments) {
    const method = p.method as string;
    if (methodTotals[method]) {
      methodTotals[method] = methodTotals[method].plus(p.amount);
    }
  }

  const productsSold = payments.reduce((acc, p) => {
    return acc + p.saleOrder.lines.reduce((lineAcc, line) => lineAcc + Number(line.quantity), 0);
  }, 0);

  // Build detailed report
  const report = {
    closureTime: new Date().toISOString(),
    timezone: NICARAGUA_TZ,
    branchId,
    totalSales: totalSales.toString(),
    transactionCount,
    paymentMethods: Object.fromEntries(
      Object.entries(methodTotals).map(([k, v]) => [k, v.toString()])
    ),
    productsSold,
    orders: payments.map((p) => ({
      orderId: p.saleOrder.id,
      orderNumber: p.saleOrder.orderNumber,
      amount: p.amount.toString(),
      method: p.method,
      paidAt: p.paidAt.toISOString(),
    })),
  };

  // Close all open cash sessions for this branch
  const openSessions = await prisma.cashSession.findMany({
    where: {
      physicalCashBox: { branchId },
      status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] },
    },
  });

  for (const session of openSessions) {
    await prisma.cashSession.update({
      where: { id: session.id },
      data: {
        status: CashSessionStatus.AUTO_CLOSED,
        closedAt: new Date(),
        activeSessionKey: null,
      },
    });
  }

  // Create the closure record
  const closure = await prisma.cashClosure.create({
    data: {
      branchId,
      closureDate: today,
      closureType: "AUTO",
      totalSales,
      transactionCount,
      cashTotal: methodTotals.CASH,
      cardTotal: methodTotals.CARD,
      transferTotal: methodTotals.TRANSFER,
      creditTotal: methodTotals.CREDIT,
      mixedTotal: methodTotals.MIXED,
      productsSold: Math.round(productsSold),
      reportJson: report as unknown as Prisma.JsonObject,
    },
  });

  // Log the closure
  await prisma.cashClosureLog.create({
    data: {
      cashClosureId: closure.id,
      action: "AUTO_CLOSE",
      metadataJson: {
        totalSales: totalSales.toString(),
        transactionCount,
        sessionsClosedCount: openSessions.length,
      } as unknown as Prisma.JsonObject,
    },
  });

  await logAuditEvent({
    branchId,
    module: "cash_closure",
    action: "AUTO_CLOSE",
    entityType: "CashClosure",
    entityId: closure.id,
    metadataJson: {
      totalSales: totalSales.toString(),
      transactionCount,
    },
  });

  return { closureId: closure.id, alreadyClosed: false };
}

/* ── Execute automatic closure for ALL active branches ── */

export async function executeAutoClosureForAllBranches(): Promise<Array<{ branchId: string; closureId: string; alreadyClosed: boolean }>> {
  const branches = await prisma.branch.findMany({ where: { isActive: true } });
  const results: Array<{ branchId: string; closureId: string; alreadyClosed: boolean }> = [];

  for (const branch of branches) {
    try {
      const result = await executeAutoClosure(branch.id);
      results.push({ branchId: branch.id, ...result });
    } catch (error) {
      console.error(`[CashClosure] Failed to close branch ${branch.id}:`, error);
    }
  }

  return results;
}

/* ── Emergency Reopening ── */

export async function reopenCashClosure(input: {
  branchId: string;
  actorUserId: string;
  reason?: string;
}): Promise<{ closure: NonNullable<Awaited<ReturnType<typeof prisma.cashClosure.findFirst>>> }> {
  const today = getNicaraguaDate();

  const closure = await prisma.cashClosure.findFirst({
    where: { branchId: input.branchId, closureDate: today },
  });

  if (!closure) {
    throw new Error("NO_CLOSURE_TO_REOPEN");
  }

  if (closure.isPermanentlyClosed) {
    throw new Error("CLOSURE_PERMANENTLY_CLOSED");
  }

  // Update the closure to reopened state
  const updated = await prisma.cashClosure.update({
    where: { id: closure.id },
    data: {
      isReopened: true,
      reopenedAt: new Date(),
      reopenedByUserId: input.actorUserId,
      reopenCount: { increment: 1 },
      emergencySalesCount: 0, // Reset counter on each reopen
    },
  });

  await prisma.cashClosureLog.create({
    data: {
      cashClosureId: closure.id,
      action: "REOPEN",
      performedByUserId: input.actorUserId,
      metadataJson: {
        reason: input.reason ?? "Emergency reopening",
        reopenCount: updated.reopenCount,
      } as unknown as Prisma.JsonObject,
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "cash_closure",
    action: "EMERGENCY_REOPEN",
    entityType: "CashClosure",
    entityId: closure.id,
    metadataJson: {
      reason: input.reason ?? "Emergency reopening",
      reopenCount: updated.reopenCount,
    },
  });

  return { closure: updated };
}

/* ── Record emergency sale and check if permanent close needed ── */

export async function recordEmergencySale(branchId: string, saleOrderId: string, actorUserId: string): Promise<{
  remainingSales: number;
  permanentlyClosed: boolean;
}> {
  const today = getNicaraguaDate();

  const closure = await prisma.cashClosure.findFirst({
    where: { branchId, closureDate: today, isReopened: true, isPermanentlyClosed: false },
  });

  if (!closure) {
    return { remainingSales: 0, permanentlyClosed: false };
  }

  const newCount = closure.emergencySalesCount + 1;
  const shouldPermanentlyClose = newCount >= closure.maxEmergencySales;

  await prisma.cashClosure.update({
    where: { id: closure.id },
    data: {
      emergencySalesCount: newCount,
      isPermanentlyClosed: shouldPermanentlyClose,
      closureType: shouldPermanentlyClose ? "PERMANENT" : closure.closureType,
    },
  });

  await prisma.cashClosureLog.create({
    data: {
      cashClosureId: closure.id,
      action: shouldPermanentlyClose ? "PERMANENT_CLOSE" : "EMERGENCY_SALE",
      performedByUserId: actorUserId,
      metadataJson: {
        saleOrderId,
        emergencySalesCount: newCount,
        maxEmergencySales: closure.maxEmergencySales,
      } as unknown as Prisma.JsonObject,
    },
  });

  if (shouldPermanentlyClose) {
    // Close any open sessions again
    const openSessions = await prisma.cashSession.findMany({
      where: {
        physicalCashBox: { branchId },
        status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] },
      },
    });

    for (const session of openSessions) {
      await prisma.cashSession.update({
        where: { id: session.id },
        data: {
          status: CashSessionStatus.PERMANENTLY_CLOSED,
          closedAt: new Date(),
          activeSessionKey: null,
        },
      });
    }

    await logAuditEvent({
      actorUserId,
      branchId,
      module: "cash_closure",
      action: "PERMANENT_CLOSE",
      entityType: "CashClosure",
      entityId: closure.id,
      metadataJson: {
        reason: "MAX_EMERGENCY_SALES_REACHED",
        emergencySalesCount: newCount,
      },
    });
  }

  return {
    remainingSales: Math.max(0, closure.maxEmergencySales - newCount),
    permanentlyClosed: shouldPermanentlyClose,
  };
}

/* ── Fetch closure reports for master dashboard ── */

export async function getClosureReports(params: {
  branchId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}) {
  const where: Record<string, unknown> = {};

  if (params.branchId) {
    where.branchId = params.branchId;
  }

  if (params.startDate || params.endDate) {
    where.closureDate = {};
    if (params.startDate) {
      (where.closureDate as Record<string, unknown>).gte = new Date(params.startDate);
    }
    if (params.endDate) {
      (where.closureDate as Record<string, unknown>).lte = new Date(params.endDate);
    }
  }

  const page = params.page ?? 1;
  const limit = params.limit ?? 50;

  const [closures, total] = await Promise.all([
    prisma.cashClosure.findMany({
      where: where as any,
      include: {
        branch: { select: { id: true, code: true, name: true } },
        logs: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { closureDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.cashClosure.count({ where: where as any }),
  ]);

  return { closures, total, page, limit };
}
