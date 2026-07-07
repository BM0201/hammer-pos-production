import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { payAllPendingDisbursements } from "@/modules/payroll/payroll-disbursement-service";

/**
 * POST /api/payroll/disbursements/pay-pending
 * Body: { period: "FIRST_HALF" | "SECOND_HALF", branchId?: string }
 *
 * Procesamiento masivo del "corte por quincena": paga de una sola vez todas las
 * quincenas pendientes (de todas las corridas POSTED) del período indicado,
 * opcionalmente acotado a una sucursal. Solo Master.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertFinanceAccess(session);

    const body = (await req.json()) as { period?: string; branchId?: string };
    const period =
      body.period === "FIRST_HALF" ? "FIRST_HALF" : body.period === "SECOND_HALF" ? "SECOND_HALF" : null;
    if (!period) {
      return fail("INVALID_INPUT", "El período debe ser 'FIRST_HALF' o 'SECOND_HALF'", 400);
    }

    const result = await payAllPendingDisbursements(period, session.userId, body.branchId || undefined);
    return ok(result);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
