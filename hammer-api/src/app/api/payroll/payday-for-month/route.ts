import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { paydayFor } from "@/modules/payroll/payday-calendar";

/**
 * Ambas fechas de pago (1ª y 2ª quincena) de un mes específico — para el
 * texto explícito de posteo (prompt-planilla-calendario-quincenas.md §4):
 * "qué mes se postea, ambas fechas con nota si alguna se ajustó". Distinto
 * de /next-payday, que responde "¿cuál es el próximo pago desde hoy?" para
 * un widget de calendario; este responde por un mes arbitrario ya elegido
 * en la pantalla de Calcular Nómina, usando la MISMA fuente (paydayFor) que
 * generateDisbursementsForRun usará al postear.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session!);

    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return fail("VALIDATION_ERROR", "year/month invalidos.", 400);
    }

    return ok({
      firstHalf: paydayFor(year, month, 1),
      secondHalf: paydayFor(year, month, 2),
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
