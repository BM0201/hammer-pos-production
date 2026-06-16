import { ok } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { requireBranchCapability, isMaster } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { executeSaleCancellation, getSaleCancellation } from "@/modules/sales-returns/service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const { id } = await context.params;
    const cancellation = await getSaleCancellation(id);
    if (!isMaster(session)) requireBranchCapability(session, cancellation.branchId, CAPABILITIES.SALE_CANCELLATION_EXECUTE);
    return ok(await executeSaleCancellation(id, {
      userId: session.userId,
      roleCode: session.roleCode,
      globalRoles: session.globalRoles as string[],
    }));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
