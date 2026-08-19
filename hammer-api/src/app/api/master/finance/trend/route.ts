import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster, canInBranch, hasCapabilityInAnyAssignedBranch } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { getFinanceTrend } from "@/modules/finance/service";
import { financeTrendSchema } from "@/modules/finance/validators";

/**
 * GET /api/master/finance/trend?months=6&branchId=…
 * Serie mensual del desempeño real (base caja) para el gráfico de trayectoria.
 * Mismo RBAC que /summary: Master ve todo; BranchAdmin con FINANCE_VIEW su sucursal.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const parsed = financeTrendSchema.safeParse({
      branchId: url.searchParams.get("branchId") ?? undefined,
      months: url.searchParams.get("months") ?? undefined,
    });
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const branchId = parsed.data.branchId ?? null;

    if (!isMaster(session)) {
      if (branchId) {
        if (!canInBranch(session, branchId, CAPABILITIES.FINANCE_VIEW)) {
          return fail("FORBIDDEN", "No tienes permiso para ver finanzas de esta sucursal.", 403);
        }
      } else if (!hasCapabilityInAnyAssignedBranch(session, CAPABILITIES.FINANCE_VIEW)) {
        return fail("FORBIDDEN", "No tienes permiso para ver finanzas.", 403);
      }
    }

    return ok(await getFinanceTrend({ branchId, months: parsed.data.months }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
