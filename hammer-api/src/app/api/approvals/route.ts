import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { approvalService } from "@/modules/approvals/service";
import { approvalListQuerySchema } from "@/modules/approvals/validators";
import { can, canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    if (!canInAnyAssignedBranch(session, CAPABILITIES.APPROVAL_REQUEST_REVIEW)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const { searchParams } = new URL(request.url);
    const parsed = approvalListQuerySchema.safeParse({
      branchId: searchParams.get("branchId") ?? undefined,
      includeResolved: searchParams.get("includeResolved") ?? undefined,
    });

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid query", 400);
    }

    const branchId = parsed.data.branchId;

    if (branchId && !isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.APPROVAL_REQUEST_REVIEW)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const reviewBranchIds = session.branchMemberships
      .filter((membership) => can(membership.roleCode, CAPABILITIES.APPROVAL_REQUEST_REVIEW))
      .map((membership) => membership.branchId);

    const data = await approvalService.listRequests({
      branchId: isMaster(session) ? branchId : branchId,
      branchIds: isMaster(session) ? undefined : (branchId ? [branchId] : reviewBranchIds),
      includeResolved: parsed.data.includeResolved,
    });

    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
