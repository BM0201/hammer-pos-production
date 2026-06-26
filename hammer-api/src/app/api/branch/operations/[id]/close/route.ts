import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { closeOperationalDay, getOperationalDayBranchId } from "@/modules/operations/service";
import { closeOperationalDaySchema } from "@/modules/operations/validators";
import { isMaster } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const { id } = await context.params;
    const branchId = await getOperationalDayBranchId(id);
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.OPERATIONAL_DAY_CLOSE)) {
      return fail("FORBIDDEN", "No tienes permiso para cerrar el dia operativo.", 403);
    }
    const parsed = closeOperationalDaySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Datos invalidos.", 400, parsed.error.flatten());
    return ok(await closeOperationalDay({
      id,
      actorUserId: session.userId,
      note: parsed.data.note,
      forceClose: parsed.data.forceClose,
      isMaster: isMaster(session),
      acknowledgedWarnings: parsed.data.acknowledgedWarnings,
    }));
  } catch (error) {
    if (error instanceof Error && error.message === "OPERATIONAL_DAY_HAS_BLOCKERS") {
      return fail("OPERATIONAL_DAY_HAS_BLOCKERS", "El dia operativo tiene bloqueantes sin resolver.", 409);
    }
    if (error instanceof Error && error.message === "OPERATIONAL_DAY_CLOSE_NOTE_REQUIRED") {
      return fail("OPERATIONAL_DAY_CLOSE_NOTE_REQUIRED", "Debes ingresar una nota para cerrar con advertencias.", 400);
    }
    return toHttpErrorResponse(error);
  }
}
