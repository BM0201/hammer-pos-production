import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { dispatchOrderSchema } from "@/modules/dispatch/validators";
import { logDispatchDenied, markOrderDispatched } from "@/modules/dispatch/service";
import { prisma } from "@/lib/prisma";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { approvalService } from "@/modules/approvals/service";
import { APPROVAL_REQUEST_TYPES } from "@/modules/approvals/constants";
import { requireCsrf } from "@/modules/security/csrf";

const CONFLICT_REASONS = new Set(["DISPATCH_INVALID_STATUS", "DISPATCH_ALREADY_COMPLETED"]);

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  let targetOrderId = "unknown";
  let targetBranchId: string | undefined;

  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { orderId } = await context.params;
    const payload = (await request.json().catch(() => ({}))) as { notes?: string | null };
    const parsed = dispatchOrderSchema.safeParse({ orderId, notes: payload.notes });
    if (!parsed.success) {
      return NextResponse.json({ message: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
    }

    targetOrderId = parsed.data.orderId;

    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: parsed.data.orderId } });
    targetBranchId = order.branchId;

    if (!canInAnyAssignedBranch(session, CAPABILITIES.DISPATCH_MARK)) {
      await logDispatchDenied({
        actorUserId: session.userId,
        branchId: order.branchId,
        entityId: parsed.data.orderId,
        reason: "FORBIDDEN_ROLE",
        metadata: { role: session.roleCode },
      });
      return NextResponse.json({ message: "Forbidden", reason: "FORBIDDEN_ROLE" }, { status: 403 });
    }

    if (!isMaster(session) && !canInBranch(session, order.branchId, CAPABILITIES.DISPATCH_MARK)) {
      await logDispatchDenied({
        actorUserId: session.userId,
        branchId: order.branchId,
        entityId: parsed.data.orderId,
        reason: "FORBIDDEN_BRANCH",
      });
      return NextResponse.json({ message: "Forbidden", reason: "FORBIDDEN_BRANCH" }, { status: 403 });
    }

    let data: Awaited<ReturnType<typeof markOrderDispatched>> | null = null;
    try {
      data = await markOrderDispatched({
        orderId: parsed.data.orderId,
        actorUserId: session.userId,
        notes: parsed.data.notes,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "DISPATCH_INVALID_STATUS") {
        const approval = await approvalService.createRequest({
          branchId: order.branchId,
          requestedByUserId: session.userId,
          type: APPROVAL_REQUEST_TYPES.OPERATION_OVERRIDE,
          referenceType: "DISPATCH_OVERRIDE",
          referenceId: order.id,
          reason: parsed.data.notes?.trim() || "Corrección excepcional para despacho fuera de estado esperado.",
          payloadJson: {
            orderId: order.id,
            orderStatus: order.status,
            requestedAction: "MARK_DISPATCHED_OVERRIDE",
          },
        });

        return NextResponse.json(
          {
            status: "REQUESTED",
            requestId: approval.requestId,
            created: approval.created,
            message: "Solicitud enviada.",
            reason: "APPROVAL_REQUESTED",
          },
          { status: 202 },
        );
      }
      throw error;
    }

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && CONFLICT_REASONS.has(error.message)) {
      const session = await getCurrentSession();
      await logDispatchDenied({
        actorUserId: session?.userId,
        branchId: targetBranchId,
        entityId: targetOrderId,
        reason: error.message,
      });
      return NextResponse.json({ message: error.message, reason: error.message }, { status: 409 });
    }
    return toHttpErrorResponse(error);
  }
}
