import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { previewOperationalDayChecklist, getOperationalDayBranchId } from "@/modules/operations/service";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMaster } from "@/modules/rbac/guards";

/** Solo lectura — el checklist informativo que se muestra en el diálogo de confirmación. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const { id } = await context.params;
    const branchId = await getOperationalDayBranchId(id);
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.OPERATIONAL_DAY_CLOSE)) {
      return fail("FORBIDDEN", "No tienes permiso para previsualizar este día.", 403);
    }
    return ok(await previewOperationalDayChecklist(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
