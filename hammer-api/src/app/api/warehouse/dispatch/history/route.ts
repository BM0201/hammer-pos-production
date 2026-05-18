import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster, requireBranchCapability, getBranchIdsWithCapability } from "@/modules/rbac/guards";
import { dispatchListSchema } from "@/modules/dispatch/validators";
import { listDispatchHistory } from "@/modules/dispatch/service";
import { ok, forbidden, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { CAPABILITIES } from "@/modules/rbac/policies";

/**
 * Phase 8 fix: Dispatch history with proper branch scoping.
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
      requireBranchCapability(session, requestedBranchId, CAPABILITIES.DISPATCH_VIEW);

      const data = await listDispatchHistory({
        branchId: requestedBranchId,
        includeAllBranches: false,
      });
      return ok(data);
    }

    if (isMaster(session)) {
      const data = await listDispatchHistory({
        branchId: "",
        includeAllBranches: true,
      });
      return ok(data);
    }

    const allowedBranches = getBranchIdsWithCapability(session, CAPABILITIES.DISPATCH_VIEW);
    if (allowedBranches.length === 0) {
      return forbidden("No tiene permisos de despacho en ninguna sucursal");
    }

    const data = await listDispatchHistory({
      branchId: allowedBranches[0],
      includeAllBranches: false,
    });
    return ok(data);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
