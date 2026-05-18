import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster, requireBranchCapability, getBranchIdsWithCapability } from "@/modules/rbac/guards";
import { dispatchListSchema } from "@/modules/dispatch/validators";
import { listDispatchPendingOrders } from "@/modules/dispatch/service";
import { ok, forbidden, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { CAPABILITIES } from "@/modules/rbac/policies";

/**
 * Phase 8 fix: Dispatch pending with proper branch scoping.
 * - If branchId provided: validate user has DISPATCH_VIEW for that branch
 * - If no branchId: master sees all, branch-scoped sees only their branches
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const parsed = dispatchListSchema.safeParse({ branchId: searchParams.get("branchId") ?? undefined });
    if (!parsed.success) {
      return validationFail(parsed.error.flatten());
    }

    const requestedBranchId = parsed.data.branchId;

    if (requestedBranchId) {
      // Specific branch: validate user has DISPATCH_VIEW for it
      requireBranchCapability(session, requestedBranchId, CAPABILITIES.DISPATCH_VIEW);

      const data = await listDispatchPendingOrders({
        branchId: requestedBranchId,
        includeAllBranches: false,
      });
      return ok(data);
    }

    // No specific branch
    if (isMaster(session)) {
      // Global user: can see all branches
      const data = await listDispatchPendingOrders({
        branchId: "",
        includeAllBranches: true,
      });
      return ok(data);
    }

    // Branch-scoped user: get only branches they have DISPATCH_VIEW in
    const allowedBranches = getBranchIdsWithCapability(session, CAPABILITIES.DISPATCH_VIEW);
    if (allowedBranches.length === 0) {
      return forbidden("No tiene permisos de despacho en ninguna sucursal");
    }

    // Fetch for first allowed branch (most common case: single branch user)
    // For multi-branch users, they should specify branchId
    const data = await listDispatchPendingOrders({
      branchId: allowedBranches[0],
      includeAllBranches: false,
    });
    return ok(data);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
