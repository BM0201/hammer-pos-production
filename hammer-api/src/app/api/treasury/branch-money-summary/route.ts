import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { getBranchMoneySummary, weekStartFromInstant } from "@/modules/treasury/branch-money-summary";
import { businessDateWeekRange, businessDateFromInput } from "@/modules/operations/business-date";

/**
 * "Dinero de la semana" (Admin de Sucursal, prompt-modulo-dinero-semana-
 * sucursal.md). MISMA fuente que la Tesorería de Master (§4) — esta ruta y
 * cualquier consumidor de Master llaman a getBranchMoneySummary, ninguno
 * arma sus propios totales. La autorización se verifica acá (§4: "el admin
 * no puede ver otra sucursal, y eso se verifica en el servidor, no ocultando
 * el selector") — doc prueba 12.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);
    requireBranchCapability(session, branchId, CAPABILITIES.TREASURY_VIEW_BRANCH);

    const weekStartParam = url.searchParams.get("weekStart");
    const weekStart = weekStartParam
      ? businessDateWeekRange(businessDateFromInput(weekStartParam)).weekStart
      : weekStartFromInstant();

    return ok(await getBranchMoneySummary({ branchId, weekStart }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
