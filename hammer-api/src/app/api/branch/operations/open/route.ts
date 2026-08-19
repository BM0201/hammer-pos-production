import { created, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { openOperationalDay } from "@/modules/operations/service";
import { openOperationalDaySchema } from "@/modules/operations/validators";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMaster } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const parsed = openOperationalDaySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Datos invalidos.", 400, parsed.error.flatten());
    if (!isMaster(session) && !canInBranch(session, parsed.data.branchId, CAPABILITIES.OPERATIONAL_DAY_OPEN)) {
      return fail("FORBIDDEN", "No tienes permiso para abrir el dia operativo.", 403);
    }
    return created(await openOperationalDay({ ...parsed.data, actorUserId: session.userId, isMaster: isMaster(session) }));
  } catch (error) {
    if (error instanceof Error && error.message === "OPERATIONAL_DAY_ALREADY_OPEN") {
      return fail("CONFLICT", "Ya existe un dia operativo abierto para esta sucursal.", 409);
    }
    return toHttpErrorResponse(error);
  }
}
