import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { can, canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { auditQuerySchema } from "@/modules/audit/validators";
import { listAuditLogs } from "@/modules/audit/service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    if (!canInAnyAssignedBranch(session, CAPABILITIES.AUDIT_VIEW)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const { searchParams } = new URL(request.url);
    const parsed = auditQuerySchema.safeParse({
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      branchId: searchParams.get("branchId") ?? undefined,
      module: searchParams.get("module") ?? undefined,
      action: searchParams.get("action") ?? undefined,
      actorUsername: searchParams.get("actorUsername") ?? undefined,
      result: searchParams.get("result") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid query", 400);
    }

    const query = parsed.data;
    const reviewBranchIds = session.branchMemberships
      .filter((membership) => can(membership.roleCode, CAPABILITIES.AUDIT_VIEW))
      .map((membership) => membership.branchId);

    if (query.branchId && !isMaster(session) && !canInBranch(session, query.branchId, CAPABILITIES.AUDIT_VIEW)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const data = await listAuditLogs({
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      branchId: isMaster(session) ? query.branchId : undefined,
      allowedBranchIds: isMaster(session) ? undefined : (query.branchId ? [query.branchId] : reviewBranchIds),
      module: query.module,
      action: query.action,
      actorUsername: query.actorUsername,
      result: query.result,
      limit: query.limit,
    });

    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
