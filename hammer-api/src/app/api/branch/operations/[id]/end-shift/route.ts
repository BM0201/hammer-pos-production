import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { endShiftOperationalDay, getOperationalDayBranchId } from "@/modules/operations/service";
import { endShiftOperationalDaySchema } from "@/modules/operations/validators";
import { isMaster } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";

/**
 * "Cerrar jornada" — barre el día de ACTIVE a AWAITING_REVIEW. No confirma
 * nada: solo saca el día del turno en curso y lo deja esperando en la cola de
 * pendientes. Confirmar (la firma de Master) es un paso aparte.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const { id } = await context.params;
    const branchId = await getOperationalDayBranchId(id);
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.OPERATIONAL_DAY_CLOSE)) {
      return fail("FORBIDDEN", "No tienes permiso para cerrar la jornada.", 403);
    }
    const parsed = endShiftOperationalDaySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Datos invalidos.", 400, parsed.error.flatten());
    return ok(await endShiftOperationalDay({ id, actorUserId: session.userId, note: parsed.data.note }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
