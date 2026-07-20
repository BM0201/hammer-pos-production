import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, validationFail } from "@/lib/api/response";
import { getRollCall, takeRollCall } from "@/modules/payroll/employee-absences-service";

/**
 * Pase de asistencia diario desde el POS (pantalla Cobros, antes del primer
 * cobro del día — la caja ya está abierta con su monto contado).
 *
 * Capability: CASH_SESSION_OPEN — quien puede abrir la caja de la sucursal
 * puede pasar lista de SU sucursal (no requiere acceso de Finanzas: el
 * roster viene reducido a id/nombre/puesto, sin salarios).
 */

const takeSchema = z.object({
  branchId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date debe ser YYYY-MM-DD"),
  entries: z
    .array(
      z.object({
        employeeId: z.string().min(1),
        status: z.enum(["PRESENT", "PRESENT_LATE", "UNJUSTIFIED", "JUSTIFIED"]),
        notes: z.string().max(300).optional(),
      }),
    )
    .max(200),
});

/** GET ?branchId=&date=YYYY-MM-DD — estado del pase + personal activo de la sucursal. */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(req.url);
    const branchId = url.searchParams.get("branchId");
    const date = url.searchParams.get("date");
    if (!branchId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return validationFail("branchId y date (YYYY-MM-DD) son requeridos");
    }
    requireBranchCapability(session, branchId, CAPABILITIES.CASH_SESSION_OPEN);

    return ok(await getRollCall(branchId, date));
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

/** POST — toma (o corrige) el pase del día y registra las faltas marcadas. */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);

    const parsed = takeSchema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.issues);
    requireBranchCapability(session, parsed.data.branchId, CAPABILITIES.CASH_SESSION_OPEN);

    return ok(await takeRollCall(parsed.data, session!.userId));
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
