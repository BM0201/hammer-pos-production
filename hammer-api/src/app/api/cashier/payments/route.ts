import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { postPaymentSchema } from "@/modules/payments/validators";
import { postSaleOrderPayment } from "@/modules/payments/service";
import { prisma } from "@/lib/prisma";
import { isMaster } from "@/modules/rbac/guards";
import { logAuditEvent } from "@/modules/audit/service";
import { PAYMENT_AUDIT_EVENTS } from "@/modules/payments/audit-events";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";

const PAYMENT_ERROR_STATUS: Record<string, number> = {
  PAYMENT_INVALID_STATUS: 409,
  PAYMENT_ALREADY_POSTED: 409,
  INVALID_PAYMENT_AMOUNT: 400,
  NO_ACTIVE_CASH_BOX: 409,
  NO_ACTIVE_CASH_SESSION: 409,
  INVALID_CASH_SESSION: 409,
  CASH_SESSION_NOT_OPEN: 409,
  CASH_BOX_BRANCH_MISMATCH: 403,
  CASH_BOX_INACTIVE: 409,
  FORBIDDEN_BRANCH: 403,
  INSUFFICIENT_STOCK_AT_PAYMENT: 409,
  INSUFFICIENT_STOCK: 409,
};

function toPaymentErrorResponse(reason: string) {
  const status = PAYMENT_ERROR_STATUS[reason];
  if (!status) return null;

  const message = reason
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return NextResponse.json({ message, reason }, { status });
}

export async function POST(request: Request) {
  let sessionUserId: string | null = null;
  let targetBranchId: string | null = null;
  let targetOrderId: string | null = null;

  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    sessionUserId = session.userId;

    const parsed = postPaymentSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid payload", reason: "INVALID_PAYLOAD" },
        { status: 400 },
      );
    }

    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: parsed.data.saleOrderId } });
    targetBranchId = order.branchId;
    targetOrderId = order.id;

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_PAYMENTS_COLLECT)) {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: order.branchId,
        module: "payments",
        action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
        entityType: "SaleOrder",
        entityId: order.id,
        metadataJson: { reason: "FORBIDDEN_ROLE", role: session.roleCode },
      });
      return NextResponse.json({ message: "Forbidden", reason: "FORBIDDEN_ROLE" }, { status: 403 });
    }

    if (!isMaster(session) && !canInBranch(session, order.branchId, CAPABILITIES.CASH_PAYMENTS_COLLECT)) {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: order.branchId,
        module: "payments",
        action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
        entityType: "SaleOrder",
        entityId: order.id,
        metadataJson: { reason: "FORBIDDEN_BRANCH" },
      });
      return NextResponse.json({ message: "Forbidden", reason: "FORBIDDEN_BRANCH" }, { status: 403 });
    }

    const data = await postSaleOrderPayment({
      saleOrderId: parsed.data.saleOrderId,
      cashSessionId: parsed.data.cashSessionId,
      amount: parsed.data.amount,
      method: parsed.data.method,
      actorUserId: session.userId,
      referenceNumber: parsed.data.referenceNumber,
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      const mapped = toPaymentErrorResponse(error.message);
      if (mapped) {
        if (["INVALID_CASH_SESSION", "CASH_SESSION_NOT_OPEN", "CASH_BOX_INACTIVE", "CASH_BOX_BRANCH_MISMATCH", "INSUFFICIENT_STOCK", "INSUFFICIENT_STOCK_AT_PAYMENT"].includes(error.message) && sessionUserId && targetOrderId) {
          await logAuditEvent({
            actorUserId: sessionUserId,
            branchId: targetBranchId ?? undefined,
            module: "payments",
            action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
            entityType: "SaleOrder",
            entityId: targetOrderId,
            metadataJson: { reason: error.message, route: "POST /api/cashier/payments" },
          });
        }
        return mapped;
      }
    }

    return toHttpErrorResponse(error);
  }
}
