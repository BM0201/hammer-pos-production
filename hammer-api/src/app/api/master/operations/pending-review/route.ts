import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { listPendingReviewDays } from "@/modules/operations/service";

/**
 * Día Operativo 360 — la cola única: días AWAITING_REVIEW con reviewStatus
 * PENDING, del más viejo primero. Ninguno bloquea la operación de hoy;
 * ninguno caduca ni se borra — esperan la firma de Master indefinidamente.
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok(await listPendingReviewDays());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
