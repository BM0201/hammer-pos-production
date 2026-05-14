import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { submitSaleOrderToPendingPayment } from "@/modules/sales/service";
import { saleOrderTransportSchema } from "@/modules/sales/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { isMaster } from "@/modules/rbac/guards";
import { logAuditEvent } from "@/modules/audit/service";
import { SALE_AUDIT_EVENTS } from "@/modules/sales/audit-events";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await context.params;
    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id } });

    if (!canInAnyAssignedBranch(session, CAPABILITIES.SALES_SUBMIT_PAYMENT)) {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_SUBMIT_DENIED,
        entityType: "SaleOrder",
        entityId: id,
        metadataJson: { reason: "FORBIDDEN_ROLE", role: session.roleCode },
      });
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    if (!isMaster(session) && !canInBranch(session, order.branchId, CAPABILITIES.SALES_SUBMIT_PAYMENT)) {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_SUBMIT_DENIED,
        entityType: "SaleOrder",
        entityId: id,
        metadataJson: { reason: "FORBIDDEN_BRANCH" },
      });
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const transportPayload = saleOrderTransportSchema.safeParse(await request.json().catch(() => ({})));
    if (!transportPayload.success) {
      return NextResponse.json({ message: "Invalid payload", issues: transportPayload.error.issues }, { status: 400 });
    }

    const data = await submitSaleOrderToPendingPayment({
      saleOrderId: id,
      actorUserId: session.userId,
      requiresTransport: transportPayload.data.requiresTransport,
      transportAmount: transportPayload.data.transportAmount,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
