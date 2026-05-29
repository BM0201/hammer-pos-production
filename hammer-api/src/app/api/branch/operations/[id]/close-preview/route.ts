import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { closePreviewOperationalDay, getOperationalDayBranchId } from "@/modules/operations/service";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMaster } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const { id } = await context.params;
    const branchId = await getOperationalDayBranchId(id);
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.OPERATIONAL_DAY_CLOSE)) {
      return fail("FORBIDDEN", "No tienes permiso para previsualizar cierre.", 403);
    }
    return ok(await closePreviewOperationalDay(id, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
