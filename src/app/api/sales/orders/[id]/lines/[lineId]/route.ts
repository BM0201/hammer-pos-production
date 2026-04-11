import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { removeSaleOrderLine, updateSaleOrderLine } from "@/modules/sales/service";
import { updateSaleOrderLineSchema } from "@/modules/sales/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { isMaster } from "@/modules/rbac/guards";
import { logAuditEvent } from "@/modules/audit/service";
import { SALE_AUDIT_EVENTS } from "@/modules/sales/audit-events";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";

async function checkBranch(
  session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>,
  orderId: string,
  branchId: string
) {
  if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.SALES_DRAFT_MANAGE)) {
    await logAuditEvent({
      actorUserId: session.userId,
      branchId,
      module: "sales",
      action: SALE_AUDIT_EVENTS.ORDER_LINE_MUTATION_DENIED,
      entityType: "SaleOrder",
      entityId: orderId,
      metadataJson: { reason: "FORBIDDEN_BRANCH" },
    });
    return false;
  }

  return true;
}

async function ensureCanMutateLine(session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>, orderId: string) {
  const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: orderId } });

  if (!canInAnyAssignedBranch(session, CAPABILITIES.SALES_DRAFT_MANAGE)) {
    await logAuditEvent({
      actorUserId: session.userId,
      branchId: order.branchId,
      module: "sales",
      action: SALE_AUDIT_EVENTS.ORDER_LINE_MUTATION_DENIED,
      entityType: "SaleOrder",
      entityId: orderId,
      metadataJson: { reason: "FORBIDDEN_ROLE", role: session.roleCode },
    });
    return false;
  }

  return checkBranch(session, orderId, order.branchId);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const parsed = updateSaleOrderLineSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
    }

    const { id, lineId } = await context.params;
    if (!(await ensureCanMutateLine(session, id))) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const data = await updateSaleOrderLine({ saleOrderId: id, lineId, actorUserId: session.userId, ...parsed.data });
    return NextResponse.json({ data });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { id, lineId } = await context.params;
    if (!(await ensureCanMutateLine(session, id))) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const data = await removeSaleOrderLine({ saleOrderId: id, lineId, actorUserId: session.userId });
    return NextResponse.json({ data });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
