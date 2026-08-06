import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, created, validationFail } from "@/lib/api/response";
import { listSettlements, settleEmployee, SETTLEMENT_KINDS, TERMINATION_CAUSALES } from "@/modules/payroll/employee-settlement-service";

/**
 * Liquidación de trabajador: ROLLOVER (liquidación y recontratación
 * inmediata — sigue activo, resetea antigüedad) o TERMINATION (baja
 * definitiva, requiere causal).
 */

const settleSchema = z.object({
  employeeId: z.string().min(1),
  kind: z.enum(SETTLEMENT_KINDS),
  causal: z.enum(TERMINATION_CAUSALES).optional(),
  notes: z.string().max(300).optional(),
});

/** GET /api/payroll/settlements?employeeId= — historial del empleado. */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session!);

    const employeeId = new URL(req.url).searchParams.get("employeeId");
    if (!employeeId) return validationFail("employeeId es requerido");

    return ok({ employeeId, settlements: await listSettlements(employeeId) });
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

/** POST /api/payroll/settlements — liquida (rollover o baja definitiva). */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertFinanceAccess(session!);

    const parsed = settleSchema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.issues);

    const { employeeId, ...input } = parsed.data;
    return created(await settleEmployee(employeeId, input, session!.userId));
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
