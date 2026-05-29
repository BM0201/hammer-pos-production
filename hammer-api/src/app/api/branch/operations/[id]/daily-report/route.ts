import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { getDailyReport, getOperationalDayBranchId } from "@/modules/operations/service";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMaster } from "@/modules/rbac/guards";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const { id } = await context.params;
    const branchId = await getOperationalDayBranchId(id);
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.OPERATIONS_VIEW)) {
      return fail("FORBIDDEN", "No tienes permiso para ver este reporte.", 403);
    }
    return ok(await getDailyReport(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
