import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { nextPayday } from "@/modules/payroll/payday-calendar";

/**
 * Próximo día de pago (calendario) — prompt-planilla-calendario-quincenas.md
 * §3/§6. Fuente única de fechas: el frontend consume esto en vez de
 * recalcular con effectivePayday/nextBiweeklyPayday.
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session!);

    return ok(nextPayday());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
