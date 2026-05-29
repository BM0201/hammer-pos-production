
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { closeCashSessionSchema } from "@/modules/cash-session/validators";
import { closeCashSession, logCashSessionDenied } from "@/modules/cash-session/service";
import { logAuditEvent } from "@/modules/audit/service";
import { CASH_SESSION_AUDIT_EVENTS } from "@/modules/cash-session/audit-events";
import { prisma } from "@/lib/prisma";
import { isMaster } from "@/modules/rbac/guards";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { approvalService } from "@/modules/approvals/service";
import { APPROVAL_REQUEST_TYPES } from "@/modules/approvals/constants";
import { PaymentMethod, PaymentStatus, SaleOrderStatus } from "@prisma/client";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

const CONFLICT_REASONS = new Set([
  "CASH_SESSION_NOT_RECONCILING",
  "CASH_SESSION_UNRESOLVED_ORDERS",
  "CASH_SESSION_HAS_PENDING_PAYMENTS",
  "CASH_SESSION_DISCREPANCY_REQUIRES_APPROVAL",
]);
const CASH_DISCREPANCY_APPROVAL_THRESHOLD = 5;

export async function POST(request: Request) {
  let targetSessionId = "unknown";
  let targetBranchId: string | undefined;

  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = closeCashSessionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    targetSessionId = parsed.data.cashSessionId;

    const cashSession = await prisma.cashSession.findUniqueOrThrow({
      where: { id: parsed.data.cashSessionId },
      include: { physicalCashBox: true },
    });

    targetBranchId = cashSession.physicalCashBox.branchId;

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE)) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: cashSession.physicalCashBox.branchId,
        entityId: parsed.data.cashSessionId,
        reason: "FORBIDDEN_ROLE",
        metadata: { role: session.roleCode },
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    if (
      !isMaster(session) &&
      !canInBranch(
        session,
        cashSession.physicalCashBox.branchId,
        CAPABILITIES.CASH_SESSION_OPERATE,
      )
    ) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: cashSession.physicalCashBox.branchId,
        entityId: parsed.data.cashSessionId,
        reason: "FORBIDDEN_BRANCH",
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const pendingOrders = await prisma.saleOrder.count({
      where: {
        branchId: cashSession.physicalCashBox.branchId,
        status: SaleOrderStatus.PENDING_PAYMENT,
      },
    });

    if (pendingOrders > 0) {
      return fail("CONFLICT", "CASH_SESSION_UNRESOLVED_ORDERS", 409);
    }

    const pendingPayments = await prisma.payment.count({
      where: {
        cashSessionId: cashSession.id,
        status: { not: PaymentStatus.POSTED },
      },
    });

    if (pendingPayments > 0) {
      return fail("CONFLICT", "CASH_SESSION_HAS_PENDING_PAYMENTS", 409);
    }

    const cashInAggregate = await prisma.payment.aggregate({
      where: {
        cashSessionId: cashSession.id,
        status: PaymentStatus.POSTED,
        method: PaymentMethod.CASH,
        amount: { gte: 0 },
      },
      _sum: { amount: true },
    });

    const cashOutAggregate = await prisma.payment.aggregate({
      where: {
        cashSessionId: cashSession.id,
        status: PaymentStatus.POSTED,
        method: PaymentMethod.CASH,
        amount: { lt: 0 },
      },
      _sum: { amount: true },
    });

    const openingAmount = Number(cashSession.openingAmount);
    const postedCashPayments = Number(cashInAggregate._sum.amount ?? 0);
    const refundsOrWithdrawals = Math.abs(Number(cashOutAggregate._sum.amount ?? 0));
    const expectedCash = openingAmount + postedCashPayments - refundsOrWithdrawals;
    const countedCash = Number(parsed.data.closingAmount);
    const difference = countedCash - expectedCash;

    if (Math.abs(difference) > CASH_DISCREPANCY_APPROVAL_THRESHOLD) {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: cashSession.physicalCashBox.branchId,
        module: "cash_session",
        action: CASH_SESSION_AUDIT_EVENTS.DISCREPANCY_DETECTED,
        entityType: "CashSession",
        entityId: cashSession.id,
        metadataJson: {
          openingAmount,
          postedCashPayments,
          refundsOrWithdrawals,
          expectedCash,
          countedCash,
          difference,
          threshold: CASH_DISCREPANCY_APPROVAL_THRESHOLD,
        },
      });

      const approval = await approvalService.createRequest({
        branchId: cashSession.physicalCashBox.branchId,
        requestedByUserId: session.userId,
        type: APPROVAL_REQUEST_TYPES.CASH_SESSION_DISCREPANCY,
        referenceType: "CASH_SESSION",
        referenceId: cashSession.id,
        reason: `Cierre con diferencia de caja (${difference.toFixed(2)}).`,
        payloadJson: {
          openingAmount,
          postedCashPayments,
          refundsOrWithdrawals,
          expectedCash,
          countedCash,
          difference,
          threshold: CASH_DISCREPANCY_APPROVAL_THRESHOLD,
        },
      });

      return ok({
          status: "REQUESTED",
          requestId: approval.requestId,
          created: approval.created,
          reason: "APPROVAL_REQUESTED",
          message: "Solicitud enviada.",
        });
    }

    const data = await closeCashSession({
      ...parsed.data,
      actorUserId: session.userId,
      allowedThreshold: CASH_DISCREPANCY_APPROVAL_THRESHOLD,
    });

    return ok(data);
  } catch (error) {
    if (error instanceof Error && CONFLICT_REASONS.has(error.message)) {
      const session = await getCurrentSession();
      await logCashSessionDenied({
        actorUserId: session?.userId,
        branchId: targetBranchId,
        entityId: targetSessionId,
        reason: error.message,
      });
      return fail("CONFLICT", error.message, 409);
    }
    return toHttpErrorResponse(error);
  }
}
