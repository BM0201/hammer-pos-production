import { CashSessionStatus, PaymentMethod, PaymentStatus, Prisma, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { CASH_SESSION_AUDIT_EVENTS } from "@/modules/cash-session/audit-events";
import { ensureOpenOperationalDayTx, refreshOperationalDaySummaryTx } from "@/modules/operations/service";

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export async function calculateExpectedCashForSessionTx(
  tx: Prisma.TransactionClient,
  cashSessionId: string,
  openingAmount: Prisma.Decimal | number | string,
) {
  const cashInAggregate = await tx.payment.aggregate({
    where: {
      cashSessionId,
      status: PaymentStatus.POSTED,
      method: PaymentMethod.CASH,
      amount: { gte: 0 },
    },
    _sum: { amount: true },
  });

  const cashOutAggregate = await tx.payment.aggregate({
    where: {
      cashSessionId,
      status: PaymentStatus.POSTED,
      method: PaymentMethod.CASH,
      amount: { lt: 0 },
    },
    _sum: { amount: true },
  });

  const opening = Number(openingAmount);
  const postedCashPayments = Number(cashInAggregate._sum.amount ?? 0);
  const refundsOrWithdrawals = Math.abs(Number(cashOutAggregate._sum.amount ?? 0));
  const expectedCash = opening + postedCashPayments - refundsOrWithdrawals;

  return {
    openingAmount: opening,
    postedCashPayments,
    refundsOrWithdrawals,
    expectedCash,
  };
}

export async function getActiveCashSession(params: { branchId: string; physicalCashBoxId?: string | null }) {
  return prisma.cashSession.findFirst({
    where: {
      status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] },
      physicalCashBox: {
        branchId: params.branchId,
        ...(params.physicalCashBoxId ? { id: params.physicalCashBoxId } : {}),
      },
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
      const operationalDay = await ensureOpenOperationalDayTx(tx, input.branchId);

      // FIX: Removed manual existingOpen findFirst check — rely solely on the
      // unique constraint on activeSessionKey for atomicity. This eliminates the
      // race condition where two concurrent requests could both pass the check.
      const session = await tx.cashSession.create({
        data: {
          physicalCashBoxId: input.physicalCashBoxId,
          operationalDayId: operationalDay.id,
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
            operationalDayId: operationalDay.id,
            openingAmount: input.openingAmount,
          },
        },
      });
      await refreshOperationalDaySummaryTx(tx, operationalDay.id);

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
    await refreshOperationalDaySummaryTx(tx, session.operationalDayId);

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

    const { openingAmount, postedCashPayments, refundsOrWithdrawals, expectedCash } =
      await calculateExpectedCashForSessionTx(tx, session.id, session.openingAmount);
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
        expectedCashAmount: toDecimal(expectedCash),
        countedCashAmount: toDecimal(countedCash),
        differenceAmount: toDecimal(difference),
        requiresReview: false,
        notes: input.notes ?? session.notes,
      },
    });
    await refreshOperationalDaySummaryTx(tx, session.operationalDayId);

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

export async function reviewAutoClosedCashSession(input: {
  cashSessionId: string;
  countedCashAmount: number;
  note: string;
  actorUserId: string;
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

    if (session.status !== CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW || !session.requiresReview) {
      throw new Error("CASH_SESSION_NOT_PENDING_AUTO_REVIEW");
    }

    const expectedCash = session.expectedCashAmount != null
      ? Number(session.expectedCashAmount)
      : (await calculateExpectedCashForSessionTx(tx, session.id, session.openingAmount)).expectedCash;
    const countedCash = Number(input.countedCashAmount);
    const difference = countedCash - expectedCash;
    const now = new Date();

    const updated = await tx.cashSession.update({
      where: { id: session.id },
      data: {
        status: CashSessionStatus.CLOSED,
        closedAt: session.closedAt ?? session.autoClosedAt ?? now,
        closingAmount: toDecimal(countedCash),
        countedCashAmount: toDecimal(countedCash),
        expectedCashAmount: toDecimal(expectedCash),
        differenceAmount: toDecimal(difference),
        requiresReview: false,
        reviewedAt: now,
        reviewedByUserId: input.actorUserId,
        reviewNote: input.note,
      },
    });
    await refreshOperationalDaySummaryTx(tx, session.operationalDayId);

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: session.physicalCashBox.branchId,
        module: "cash_session",
        action: CASH_SESSION_AUDIT_EVENTS.AUTO_CLOSE_REVIEWED,
        entityType: "CashSession",
        entityId: session.id,
        metadataJson: {
          expectedCash,
          countedCash,
          difference,
          note: input.note,
          autoClosedAt: session.autoClosedAt,
        },
      },
    });

    const relatedDecision = await tx.brainDecision.findUnique({
      where: { fingerprint: `cash:auto-close-review:${session.id}` },
      select: { id: true, status: true },
    });
    if (relatedDecision && relatedDecision.status !== "EXECUTED" && relatedDecision.status !== "DISMISSED") {
      await tx.brainDecision.update({
        where: { id: relatedDecision.id },
        data: {
          status: "EXECUTED",
          resolvedAt: now,
          resolvedByUserId: input.actorUserId,
          actionResultJson: {
            reviewed: true,
            cashSessionId: session.id,
            expectedCash,
            countedCash,
            difference,
            reviewedAt: now.toISOString(),
          },
        },
      });
      await tx.brainDecisionActionLog.create({
        data: {
          decisionId: relatedDecision.id,
          actorUserId: input.actorUserId,
          action: "REVIEW_COMPLETED",
          note: input.note,
          metadataJson: {
            cashSessionId: session.id,
            expectedCash,
            countedCash,
            difference,
          },
        },
      });
    }

    return {
      ...updated,
      expectedCash,
      countedCash,
      difference,
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
