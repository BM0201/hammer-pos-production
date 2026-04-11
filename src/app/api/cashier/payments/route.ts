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

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const parsed = postPaymentSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
    }

    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: parsed.data.saleOrderId } });

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
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
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
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const data = await postSaleOrderPayment({
      saleOrderId: parsed.data.saleOrderId,
      amount: parsed.data.amount,
      method: parsed.data.method,
      actorUserId: session.userId,
      referenceNumber: parsed.data.referenceNumber,
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "PAYMENT_INVALID_STATUS" || error.message === "PAYMENT_ALREADY_POSTED") {
        return NextResponse.json({ message: error.message }, { status: 409 });
      }
      if (error.message === "INVALID_PAYMENT_AMOUNT") {
        return NextResponse.json({ message: error.message }, { status: 400 });
      }
      if (error.message === "NO_ACTIVE_CASH_BOX" || error.message === "NO_ACTIVE_CASH_SESSION") {
        return NextResponse.json({ message: error.message }, { status: 409 });
      }
    }

    return toHttpErrorResponse(error);
  }
}
