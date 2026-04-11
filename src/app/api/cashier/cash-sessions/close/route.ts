import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { closeCashSessionSchema } from "@/modules/cash-session/validators";
import { closeCashSession, logCashSessionDenied } from "@/modules/cash-session/service";
import { prisma } from "@/lib/prisma";
import { isMaster } from "@/modules/rbac/guards";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { approvalService } from "@/modules/approvals/service";
import { APPROVAL_REQUEST_TYPES } from "@/modules/approvals/constants";
import { PaymentMethod, PaymentStatus } from "@prisma/client";

const CONFLICT_REASONS = new Set(["CASH_SESSION_NOT_RECONCILING"]);
const CASH_DISCREPANCY_APPROVAL_THRESHOLD = 5;

export async function POST(request: Request) {
  let targetSessionId = "unknown";
  let targetBranchId: string | undefined;

  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const parsed = closeCashSessionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid payload", issues: parsed.error.issues },
        { status: 400 },
      );
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
      return NextResponse.json(
        { message: "Forbidden", reason: "FORBIDDEN_ROLE" },
        { status: 403 },
      );
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
      return NextResponse.json(
        { message: "Forbidden", reason: "FORBIDDEN_BRANCH" },
        { status: 403 },
      );
    }

    // ── FIX: Compute expected amount = opening + cash payments in session ──
    // Previously: discrepancy = closingAmount - openingAmount (WRONG)
    // Now:        discrepancy = closingAmount - (openingAmount + totalCashPayments)
    const cashPaymentsAggregate = await prisma.payment.aggregate({
      where: {
        cashSessionId: cashSession.id,
        status: PaymentStatus.POSTED,
        method: PaymentMethod.CASH,
      },
      _sum: { amount: true },
    });

    const openingAmount = Number(cashSession.openingAmount);
    const totalCashPayments = Number(cashPaymentsAggregate._sum.amount ?? 0);
    const expectedAmount = openingAmount + totalCashPayments;
    const discrepancy = Number(parsed.data.closingAmount) - expectedAmount;

    if (Math.abs(discrepancy) > CASH_DISCREPANCY_APPROVAL_THRESHOLD) {
      const approval = await approvalService.createRequest({
        branchId: cashSession.physicalCashBox.branchId,
        requestedByUserId: session.userId,
        type: APPROVAL_REQUEST_TYPES.CASH_SESSION_DISCREPANCY,
        referenceType: "CASH_SESSION",
        referenceId: cashSession.id,
        reason: `Cierre con diferencia de caja (${discrepancy.toFixed(2)}).`,
        payloadJson: {
          openingAmount,
          totalCashPayments,
          expectedAmount,
          closingAmount: parsed.data.closingAmount,
          discrepancy,
          threshold: CASH_DISCREPANCY_APPROVAL_THRESHOLD,
        },
      });

      return NextResponse.json(
        {
          status: "REQUESTED",
          requestId: approval.requestId,
          created: approval.created,
          reason: "APPROVAL_REQUESTED",
          message: "Solicitud enviada.",
        },
        { status: 202 },
      );
    }

    const data = await closeCashSession({
      ...parsed.data,
      actorUserId: session.userId,
    });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && CONFLICT_REASONS.has(error.message)) {
      const session = await getCurrentSession();
      await logCashSessionDenied({
        actorUserId: session?.userId,
        branchId: targetBranchId,
        entityId: targetSessionId,
        reason: error.message,
      });
      return NextResponse.json(
        { message: error.message, reason: error.message },
        { status: 409 },
      );
    }
    return toHttpErrorResponse(error);
  }
}
