import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster, requireAnyBranchCapability } from "@/modules/rbac/guards";
import { dispatchListSchema } from "@/modules/dispatch/validators";
import { listDispatchPendingOrders } from "@/modules/dispatch/service";
import { ok, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { CAPABILITIES } from "@/modules/rbac/policies";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const parsed = dispatchListSchema.safeParse({ branchId: searchParams.get("branchId") ?? undefined });
    if (!parsed.success) {
      return validationFail(parsed.error.flatten());
    }

    const branchId = parsed.data.branchId ?? "";

    requireAnyBranchCapability(session, [CAPABILITIES.DISPATCH_VIEW]);

    const data = await listDispatchPendingOrders({
      branchId,
      includeAllBranches: isMaster(session) && !branchId,
    });

    return ok(data);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
