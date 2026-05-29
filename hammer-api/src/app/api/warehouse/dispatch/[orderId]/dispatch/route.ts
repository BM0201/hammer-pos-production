import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { dispatchOrderSchema } from "@/modules/dispatch/validators";
import { logDispatchDenied, markOrderDispatched } from "@/modules/dispatch/service";
import { prisma } from "@/lib/prisma";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { approvalService } from "@/modules/approvals/service";
import { APPROVAL_REQUEST_TYPES } from "@/modules/approvals/constants";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { assertBranchWorkflowAction, WORKFLOW_ACTIONS } from "@/modules/workflow/branch-workflow";

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { orderId } = await context.params;
    const payload = (await request.json().catch(() => ({}))) as { notes?: string | null };
    const parsed = dispatchOrderSchema.safeParse({ orderId, notes: payload.notes });
    if (!parsed.success) {
      return validationFail(parsed.error.flatten());
    }

    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: parsed.data.orderId } });

    // RBAC
    requireBranchCapability(session, order.branchId, CAPABILITIES.DISPATCH_MARK);

    // Workflow guard: dispatch must be enabled
    await assertBranchWorkflowAction(order.branchId, WORKFLOW_ACTIONS.MARK_DISPATCHED);

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
          reason: parsed.data.notes?.trim() || "Correccion excepcional para despacho fuera de estado esperado.",
          payloadJson: {
            orderId: order.id,
            orderStatus: order.status,
            requestedAction: "MARK_DISPATCHED_OVERRIDE",
          },
        });

        return fail("APPROVAL_REQUESTED", "Solicitud enviada.", 202, {
          requestId: approval.requestId,
          created: approval.created,
        });
      }
      throw error;
    }

    return ok(data);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
