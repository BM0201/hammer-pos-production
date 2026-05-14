import { CashSessionStatus, PaymentMethod, PaymentStatus, Prisma, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { CASH_SESSION_AUDIT_EVENTS } from "@/modules/cash-session/audit-events";

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export async function getActiveCashSession(params: { branchId: string; physicalCashBoxId: string }) {
  return prisma.cashSession.findFirst({
    where: {
      physicalCashBoxId: params.physicalCashBoxId,
      status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] },
      physicalCashBox: { branchId: params.branchId },
    },
    include: {
      physicalCashBox: true,
      openedBy: { select: { id: true, username: true, fullName: true } },
    },
    orderBy: { openedAt: "desc" },
  });
}

export async function openCashSession(input: {
  branchId: string;
  physicalCashBoxId: string;
  openingAmount: number;
  notes?: string | null;
  actorUserId: string;
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      const cashBox = await tx.physicalCashBox.findUnique({
        where: { id: input.physicalCashBoxId },
      });

      if (!cashBox || cashBox.branchId !== input.branchId || !cashBox.isActive) {
        throw new Error("CASH_SESSION_CASH_BOX_INVALID");
      }

      // FIX: Removed manual existingOpen findFirst check — rely solely on the
      // unique constraint on activeSessionKey for atomicity. This eliminates the
      // race condition where two concurrent requests could both pass the check.
      const session = await tx.cashSession.create({
        data: {
          physicalCashBoxId: input.physicalCashBoxId,
          openedByUserId: input.actorUserId,
          status: CashSessionStatus.OPEN,
          openedAt: new Date(),
          openingAmount: toDecimal(input.openingAmount),
          notes: input.notes ?? null,
          activeSessionKey: `OPEN:${input.physicalCashBoxId}`,
        },
        include: { physicalCashBox: true },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: input.branchId,
          module: "cash_session",
          action: CASH_SESSION_AUDIT_EVENTS.OPENED,
          entityType: "CashSession",
          entityId: session.id,
          metadataJson: {
            physicalCashBoxId: session.physicalCashBoxId,
            openingAmount: input.openingAmount,
          },
        },
      });

      return session;
    });
  } catch (error) {
    // FIX: Catch Prisma unique constraint violation (P2002) on activeSessionKey
    // and re-throw as a domain-specific error instead of uncontrolled 500
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("CASH_SESSION_ALREADY_OPEN");
    }
    throw error;
  }
}

export async function requestCloseCashSession(input: {
  cashSessionId: string;
  notes?: string | null;
  actorUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.cashSession.findUniqueOrThrow({
      where: { id: input.cashSessionId },
      include: { physicalCashBox: true },
    });

    if (session.status !== CashSessionStatus.OPEN) {
      throw new Error("CASH_SESSION_NOT_OPEN");
    }

    // FIX: Only block on PENDING_PAYMENT — DISPATCH_PENDING is warehouse
    // responsibility and must NOT block cashier close
    const unresolvedOrders = await tx.saleOrder.count({
      where: {
        branchId: session.physicalCashBox.branchId,
        status: { in: [SaleOrderStatus.PENDING_PAYMENT] },
      },
    });

    if (unresolvedOrders > 0) {
      throw new Error("CASH_SESSION_UNRESOLVED_ORDERS");
    }

    const pendingPayments = await tx.payment.count({
      where: {
        cashSessionId: session.id,
        status: { not: PaymentStatus.POSTED },
      },
    });

    if (pendingPayments > 0) {
      throw new Error("CASH_SESSION_HAS_PENDING_PAYMENTS");
    }

    const updated = await tx.cashSession.update({
      where: { id: session.id },
      data: {
        status: CashSessionStatus.RECONCILING,
        notes: input.notes ?? session.notes,
        activeSessionKey: null,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: session.physicalCashBox.branchId,
        module: "cash_session",
        action: CASH_SESSION_AUDIT_EVENTS.CLOSE_REQUESTED,
        entityType: "CashSession",
        entityId: session.id,
        metadataJson: {
          reason: "RECONCILIATION_REQUESTED",
          notes: input.notes ?? null,
        },
      },
    });

    return updated;
  });
}

export async function closeCashSession(input: {
  cashSessionId: string;
  closingAmount: number;
  notes?: string | null;
  actorUserId: string;
  allowedThreshold?: number;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM "CashSession"
      WHERE id = ${input.cashSessionId}
      FOR UPDATE
    `;

    const session = await tx.cashSession.findUniqueOrThrow({
      where: { id: input.cashSessionId },
      include: { physicalCashBox: true },
    });

    if (session.status !== CashSessionStatus.RECONCILING) {
      throw new Error("CASH_SESSION_NOT_RECONCILING");
    }

    const pendingOrders = await tx.saleOrder.count({
      where: {
        branchId: session.physicalCashBox.branchId,
        status: SaleOrderStatus.PENDING_PAYMENT,
      },
    });

    if (pendingOrders > 0) {
      throw new Error("CASH_SESSION_UNRESOLVED_ORDERS");
    }

    const pendingPayments = await tx.payment.count({
      where: {
        cashSessionId: session.id,
        status: { not: PaymentStatus.POSTED },
      },
    });

    if (pendingPayments > 0) {
      throw new Error("CASH_SESSION_HAS_PENDING_PAYMENTS");
    }

    const cashInAggregate = await tx.payment.aggregate({
      where: {
        cashSessionId: session.id,
        status: PaymentStatus.POSTED,
        method: PaymentMethod.CASH,
        amount: { gte: 0 },
      },
      _sum: { amount: true },
    });

    const cashOutAggregate = await tx.payment.aggregate({
      where: {
        cashSessionId: session.id,
        status: PaymentStatus.POSTED,
        method: PaymentMethod.CASH,
        amount: { lt: 0 },
      },
      _sum: { amount: true },
    });

    const openingAmount = Number(session.openingAmount);
    const postedCashPayments = Number(cashInAggregate._sum.amount ?? 0);
    const refundsOrWithdrawals = Math.abs(Number(cashOutAggregate._sum.amount ?? 0));
    const expectedCash = openingAmount + postedCashPayments - refundsOrWithdrawals;
    const countedCash = Number(input.closingAmount);
    const difference = countedCash - expectedCash;
    const threshold = input.allowedThreshold ?? 0;

    if (Math.abs(difference) > threshold) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: session.physicalCashBox.branchId,
          module: "cash_session",
          action: CASH_SESSION_AUDIT_EVENTS.DISCREPANCY_DETECTED,
          entityType: "CashSession",
          entityId: session.id,
          metadataJson: {
            expectedCash,
            countedCash,
            difference,
            threshold,
          },
        },
      });

      throw new Error("CASH_SESSION_DISCREPANCY_REQUIRES_APPROVAL");
    }

    const updated = await tx.cashSession.update({
      where: { id: session.id },
      data: {
        status: CashSessionStatus.CLOSED,
        closedByUserId: input.actorUserId,
        closedAt: new Date(),
        closingAmount: toDecimal(input.closingAmount),
        notes: input.notes ?? session.notes,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: session.physicalCashBox.branchId,
        module: "cash_session",
        action: CASH_SESSION_AUDIT_EVENTS.CLOSED,
        entityType: "CashSession",
        entityId: session.id,
        metadataJson: {
          openingAmount,
          postedCashPayments,
          refundsOrWithdrawals,
          expectedCash,
          countedCash,
          difference,
          threshold,
          notes: input.notes ?? null,
        },
      },
    });

    return {
      ...updated,
      expectedCash,
      countedCash,
      difference,
      threshold,
    };
  });
}

export async function logCashSessionDenied(input: {
  actorUserId?: string;
  branchId?: string;
  entityId: string;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "cash_session",
    action: CASH_SESSION_AUDIT_EVENTS.DENIED,
    entityType: "CashSession",
    entityId: input.entityId,
    metadataJson: {
      reason: input.reason,
      ...(input.metadata ?? {}),
    },
  });
}
