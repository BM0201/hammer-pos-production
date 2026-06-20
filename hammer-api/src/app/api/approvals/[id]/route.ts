import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { approvalService } from "@/modules/approvals/service";
import { resolveApprovalSchema } from "@/modules/approvals/validators";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMaster } from "@/modules/rbac/guards";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    if (!canInAnyAssignedBranch(session, CAPABILITIES.APPROVAL_REQUEST_REVIEW)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const { id } = await context.params;
    const parsed = resolveApprovalSchema.safeParse(await request.json());

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const approval = await approvalService.getRequestById(id);
    if (!approval) {
      return fail("NOT_FOUND", "Not found", 404);
    }

    if (!isMaster(session) && !canInBranch(session, approval.branchId, CAPABILITIES.APPROVAL_REQUEST_REVIEW)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const data = await approvalService.resolveRequest({
      requestId: id,
      actorUserId: session.userId,
      decision: parsed.data.decision,
      resolutionNotes: parsed.data.resolutionNotes,
    });

    return ok(data);
  } catch (error) {
    if (error instanceof Error && error.message === "APPROVAL_SELF_REVIEW_FORBIDDEN") {
      return fail("FORBIDDEN", "No puedes aprobar o rechazar una solicitud creada por ti mismo.", 403);
    }
    if (error instanceof Error && error.message === "APPROVAL_ALREADY_RESOLVED") {
      return fail("CONFLICT", error.message, 409);
    }
    return toHttpErrorResponse(error);
  }
}
