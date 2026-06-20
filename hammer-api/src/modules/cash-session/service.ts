import { CashMovementType, CashSessionOperatorRole, CashSessionStatus, PaymentMethod, PaymentStatus, Prisma, RoleCode, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { CASH_SESSION_AUDIT_EVENTS } from "@/modules/cash-session/audit-events";
import { ensureOpenOperationalDayTx, refreshOperationalDaySummaryTx, getOperationalWindowForNow, businessDateFromNow } from "@/modules/operations/service";
import { resolveAutoCloseReview } from "@/modules/cash-session/review-policy";

function toDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export async function calculateExpectedCashForSessionTx(
  tx: Prisma.TransactionClient,
  cashSessionId: string,
  openingAmount: Prisma.Decimal | number | string,
) {
  const cashTenderAggregate = await tx.paymentTender.aggregate({
    where: {
      method: PaymentMethod.CASH,
      payment: { cashSessionId, status: PaymentStatus.POSTED },
    },
    _sum: { amount: true },
  });

  const changeAggregate = await tx.paymentTender.aggregate({
    where: {
      method: PaymentMethod.CASH,
      payment: { cashSessionId, status: PaymentStatus.POSTED },
    },
    _sum: { changeAmount: true },
  });

  const cashMovements = await tx.cashMovement.findMany({
    where: { cashSessionId },
    select: { type: true, amount: true },
  });

  const opening = Number(openingAmount);
  const postedCashPayments = Number(cashTenderAggregate._sum.amount ?? 0);
  const cashChange = Number(changeAggregate._sum.changeAmount ?? 0);
  const movementNet = cashMovements.reduce((sum, movement) => {
    const amount = Number(movement.amount);
    if (["CASH_OUT", "BANK_DEPOSIT_OUT", "EXPENSE_OUT", "REFUND_OUT"].includes(movement.type)) return sum - amount;
    return sum + amount;
  }, 0);
  const refundsOrWithdrawals = Math.abs(Math.min(0, movementNet)) + cashChange;
  const expectedCash = opening + postedCashPayments + movementNet - cashChange;

  return {
    openingAmount: opening,
    postedCashPayments,
    refundsOrWithdrawals,
    cashMovementsNet: movementNet,
    cashChange,
    expectedCash,
  };
}

export async function syncCashSessionSnapshotTx(
  tx: Prisma.TransactionClient,
  cashSessionId: string,
) {
  const session = await tx.cashSession.findUniqueOrThrow({
    where: { id: cashSessionId },
    select: {
      id: true,
      status: true,
      openingAmount: true,
      countedCashAmount: true,
      operationalDayId: true,
    },
  });
  const snapshot = await calculateExpectedCashForSessionTx(tx, session.id, session.openingAmount);
  const countedCash = session.countedCashAmount == null ? null : Number(session.countedCashAmount);
  await tx.cashSession.update({
    where: { id: session.id },
    data: {
      expectedCashAmount: toDecimal(snapshot.expectedCash),
      ...(countedCash !== null && session.status !== CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW
        ? { differenceAmount: toDecimal(countedCash - snapshot.expectedCash) }
        : {}),
    },
  });
  if (session.operationalDayId) await refreshOperationalDaySummaryTx(tx, session.operationalDayId);
  return snapshot;
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

      if (!cashBox) throw new Error("CASH_SESSION_CASH_BOX_INVALID");
      if (cashBox.branchId !== input.branchId) throw new Error("CASH_BOX_BRANCH_MISMATCH");
      if (!cashBox.isActive) throw new Error("CASH_BOX_INACTIVE");

      // Block any active or unresolved session on the same physical box before
      // touching the operational day. This avoids silently auto-opening a day
      // when the real problem is an old box pending Master review.
      const todayBusinessDate = businessDateFromNow();
      const blockingSession = await tx.cashSession.findFirst({
        where: {
          physicalCashBoxId: input.physicalCashBoxId,
          status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING, CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW] },
        },
        select: {
          id: true,
          status: true,
          openedAt: true,
          operationalDayId: true,
          physicalCashBoxId: true,
          physicalCashBox: { select: { branchId: true } },
          operationalDay: { select: { businessDate: true } },
        },
        orderBy: { openedAt: "asc" },
      });
      if (blockingSession) {
        const isStale = !blockingSession.operationalDay?.businessDate
          || blockingSession.operationalDay.businessDate.getTime() !== todayBusinessDate.getTime();
        const metadata = {
          cashSessionId: blockingSession.id,
          branchId: blockingSession.physicalCashBox.branchId,
          cashBoxId: blockingSession.physicalCashBoxId,
          openedAt: blockingSession.openedAt,
          status: blockingSession.status,
          operationalDayId: blockingSession.operationalDayId,
        };
        const reason = blockingSession.status === CashSessionStatus.OPEN
          ? "CASH_SESSION_ALREADY_OPEN"
          : blockingSession.status === CashSessionStatus.RECONCILING
            ? (isStale ? "STALE_CASH_SESSION_RECONCILING" : "CASH_SESSION_RECONCILING")
            : (isStale ? "STALE_CASH_SESSION_PENDING_REVIEW" : "CASH_SESSION_AUTO_CLOSED_PENDING_REVIEW");
        const err = Object.assign(new Error(reason), { metadata });
        throw err;
      }

      const operationalDay = await ensureOpenOperationalDayTx(tx, input.branchId, input.actorUserId);

      // Rely on the unique constraint on activeSessionKey for OPEN sessions.
      // P2002 is caught below and re-thrown as CASH_SESSION_ALREADY_OPEN.
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

      await tx.cashSessionOperator.create({
        data: {
          cashSessionId: session.id,
          userId: input.actorUserId,
          operatorRole: CashSessionOperatorRole.OWNER_OPERATOR,
          assignedByUserId: input.actorUserId,
        },
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

export async function userCanOperateCashSessionTx(tx: Prisma.TransactionClient, input: {
  cashSessionId: string;
  userId: string;
  branchId: string;
}) {
  const actor = await tx.user.findUnique({
    where: { id: input.userId },
    select: { globalRole: true, isActive: true },
  });
  if (!actor?.isActive) return false;
  if (actor.globalRole === RoleCode.MASTER || actor.globalRole === RoleCode.OWNER || actor.globalRole === RoleCode.SYSTEM_ADMIN) return true;

  const operator = await tx.cashSessionOperator.findFirst({
    where: {
      cashSessionId: input.cashSessionId,
      userId: input.userId,
      isActive: true,
      revokedAt: null,
    },
  });
  return Boolean(operator);
}

export async function assignCashSessionOperator(input: {
  cashSessionId: string;
  userId: string;
  operatorRole: CashSessionOperatorRole;
  assignedByUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.cashSession.findUniqueOrThrow({
      where: { id: input.cashSessionId },
      include: { physicalCashBox: true },
    });
    if (session.status !== CashSessionStatus.OPEN) throw new Error("CASH_SESSION_NOT_OPEN");

    const operator = await tx.cashSessionOperator.upsert({
      where: { cashSessionId_userId: { cashSessionId: input.cashSessionId, userId: input.userId } },
      update: {
        operatorRole: input.operatorRole,
        assignedByUserId: input.assignedByUserId,
        assignedAt: new Date(),
        revokedAt: null,
        isActive: true,
      },
      create: {
        cashSessionId: input.cashSessionId,
        userId: input.userId,
        operatorRole: input.operatorRole,
        assignedByUserId: input.assignedByUserId,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.assignedByUserId,
        branchId: session.physicalCashBox.branchId,
        module: "cash_session",
        action: "CASH_SESSION_OPERATOR_ASSIGNED",
        entityType: "CashSessionOperator",
        entityId: operator.id,
        metadataJson: {
          cashSessionId: input.cashSessionId,
          userId: input.userId,
          operatorRole: input.operatorRole,
        },
      },
    });

    return operator;
  });
}

export async function revokeCashSessionOperator(input: {
  cashSessionId: string;
  userId: string;
  actorUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.cashSession.findUniqueOrThrow({
      where: { id: input.cashSessionId },
      include: { physicalCashBox: true },
    });
    const operator = await tx.cashSessionOperator.update({
      where: { cashSessionId_userId: { cashSessionId: input.cashSessionId, userId: input.userId } },
      data: { isActive: false, revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: session.physicalCashBox.branchId,
        module: "cash_session",
        action: "CASH_SESSION_OPERATOR_REVOKED",
        entityType: "CashSessionOperator",
        entityId: operator.id,
        metadataJson: { cashSessionId: input.cashSessionId, userId: input.userId },
      },
    });
    return operator;
  });
}

export async function listCashMovements(cashSessionId: string) {
  return prisma.cashMovement.findMany({
    where: { cashSessionId },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, fullName: true, username: true } },
    },
    take: 50,
  });
}

export async function createCashMovement(input: {
  cashSessionId: string;
  type: CashMovementType;
  amount: number;
  reason: string;
  notes?: string | null;
  actorUserId: string;
  approvedByUserId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.cashSession.findUniqueOrThrow({
      where: { id: input.cashSessionId },
      include: { physicalCashBox: true },
    });
    if (session.status !== CashSessionStatus.OPEN) throw new Error("CASH_SESSION_NOT_OPEN");
    if (!(await userCanOperateCashSessionTx(tx, {
      cashSessionId: input.cashSessionId,
      userId: input.actorUserId,
      branchId: session.physicalCashBox.branchId,
    }))) {
      throw new Error("CASH_SESSION_OPERATOR_REQUIRED");
    }

    const movement = await tx.cashMovement.create({
      data: {
        cashSessionId: input.cashSessionId,
        type: input.type,
        amount: toDecimal(input.amount),
        reason: input.reason,
        notes: input.notes ?? null,
        createdByUserId: input.actorUserId,
        approvedByUserId: input.approvedByUserId ?? null,
      },
    });
    await syncCashSessionSnapshotTx(tx, session.id);
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: session.physicalCashBox.branchId,
        module: "cash_session",
        action: "CASH_MOVEMENT_CREATED",
        entityType: "CashMovement",
        entityId: movement.id,
        metadataJson: {
          cashSessionId: input.cashSessionId,
          type: input.type,
          amount: input.amount,
          reason: input.reason,
        },
      },
    });
    return movement;
  });
}

export async function requestCloseCashSession(input: {
  cashSessionId: string;
  notes?: string | null;
  actorUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    // Lock the row first — prevents two concurrent close-requests from both reading
    // OPEN, both passing the status guard, and both writing RECONCILING + audit log.
    // Mirrors the pattern already used in closeCashSession and reviewAutoClosedCashSession.
    await tx.$queryRaw`
      SELECT id FROM "CashSession"
      WHERE id = ${input.cashSessionId}
      FOR UPDATE
    `;

    const session = await tx.cashSession.findUniqueOrThrow({
      where: { id: input.cashSessionId },
      include: { physicalCashBox: true },
    });

    if (session.status !== CashSessionStatus.OPEN) {
      throw new Error("CASH_SESSION_NOT_OPEN");
    }

    // Only block on PENDING_PAYMENT within the current operational window.
    // Orders from previous days with status PENDING_PAYMENT must not block
    // today's close — those belong to a past operational day.
    const { start, end } = getOperationalWindowForNow();
    const unresolvedOrderList = await tx.saleOrder.findMany({
      where: {
        branchId: session.physicalCashBox.branchId,
        status: SaleOrderStatus.PENDING_PAYMENT,
        createdAt: { gte: start, lt: end },
      },
      select: {
        id: true,
        orderNumber: true,
        grandTotal: true,
        createdAt: true,
        customer: { select: { displayName: true } },
      },
      take: 10,
      orderBy: { createdAt: "asc" },
    });

    if (unresolvedOrderList.length > 0) {
      const err = Object.assign(new Error("STALE_PENDING_PAYMENT_ORDERS"), {
        pendingOrders: unresolvedOrderList,
      });
      throw err;
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

    const { start: closeStart, end: closeEnd } = getOperationalWindowForNow();
    const pendingOrderList = await tx.saleOrder.findMany({
      where: {
        branchId: session.physicalCashBox.branchId,
        status: SaleOrderStatus.PENDING_PAYMENT,
        createdAt: { gte: closeStart, lt: closeEnd },
      },
      select: {
        id: true,
        orderNumber: true,
        grandTotal: true,
        createdAt: true,
        customer: { select: { displayName: true } },
      },
      take: 10,
      orderBy: { createdAt: "asc" },
    });

    if (pendingOrderList.length > 0) {
      const err = Object.assign(new Error("STALE_PENDING_PAYMENT_ORDERS"), {
        pendingOrders: pendingOrderList,
      });
      throw err;
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

      throw new Error("APPROVAL_REQUESTED");
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
  countedCashAmount?: number;
  confirmOk?: boolean;
  note?: string | null;
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
    const now = new Date();
    const review = resolveAutoCloseReview({
      expectedCash,
      countedCashAmount: input.countedCashAmount,
      confirmOk: input.confirmOk,
      note: input.note,
    });
    const { countedCash, difference, note } = review;

    const updated = await tx.cashSession.update({
      where: { id: session.id },
      data: {
        status: review.status,
        closedAt: session.closedAt ?? session.autoClosedAt ?? now,
        closingAmount: toDecimal(countedCash),
        countedCashAmount: toDecimal(countedCash),
        expectedCashAmount: toDecimal(expectedCash),
        differenceAmount: toDecimal(difference),
        requiresReview: false,
        reviewedAt: now,
        reviewedByUserId: input.actorUserId,
        reviewNote: note,
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
          note,
          autoClosedAt: session.autoClosedAt,
          confirmOk: Boolean(input.confirmOk),
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
            note,
          },
        },
      });
      await tx.brainDecisionActionLog.create({
        data: {
          decisionId: relatedDecision.id,
          actorUserId: input.actorUserId,
          action: "REVIEW_COMPLETED",
          note,
          metadataJson: {
            cashSessionId: session.id,
            expectedCash,
            countedCash,
            difference,
            confirmOk: Boolean(input.confirmOk),
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
