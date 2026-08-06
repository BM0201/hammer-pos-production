import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { getCurrentOperationalDay, getCurrentOperationalDayState } from "@/modules/operations/service";
import { currentOperationalDaySchema } from "@/modules/operations/validators";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { isMaster } from "@/modules/rbac/guards";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const url = new URL(request.url);
    const parsed = currentOperationalDaySchema.safeParse({ branchId: url.searchParams.get("branchId") ?? undefined });
    if (!parsed.success) return fail("VALIDATION_ERROR", "Sucursal invalida.", 400, parsed.error.flatten());
    if (!isMaster(session) && !canInBranch(session, parsed.data.branchId, CAPABILITIES.OPERATIONS_VIEW)) {
      return fail("FORBIDDEN", "No tienes permiso para ver la operacion de esta sucursal.", 403);
    }
    // Envelope: el día de HOY + el ESTADO operacional (incluye STALE_OPEN_DAY con el
    // día viejo, para que el frontend lo muestre claramente en vez de "sin día").
    const [day, stateInfo] = await Promise.all([
      getCurrentOperationalDay(parsed.data.branchId),
      getCurrentOperationalDayState(parsed.data.branchId),
    ]);
    return ok({ day, state: stateInfo.state, staleDay: stateInfo.staleDay });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
