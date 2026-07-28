import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { listPendingCloseDays } from "@/modules/operations/service";

/**
 * Día Operativo v2 Fase 5.5 — cola de días PENDING_CLOSE (más viejo primero).
 * Ninguno bloquea la operación de hoy; ninguno caduca ni se borra.
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok(await listPendingCloseDays());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
