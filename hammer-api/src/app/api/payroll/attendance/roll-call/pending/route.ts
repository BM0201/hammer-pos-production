import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";
import { listPendingRollCalls } from "@/modules/payroll/employee-absences-service";

/**
 * Pases de asistencia pendientes de confirmar por Master (anti "buddy
 * punching"): el cajero los toma, pero solo Master puede confirmarlos como
 * reales — evita que compañeros se marquen presentes entre sí en falso.
 */

/** GET ?branchId= (opcional) — pases PENDING con la marca de cada trabajador. */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const branchId = new URL(req.url).searchParams.get("branchId") ?? undefined;
    return ok(await listPendingRollCalls(branchId));
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
