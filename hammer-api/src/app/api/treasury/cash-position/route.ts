import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { getBranchCashPosition } from "@/modules/treasury/cash-monitor";

/**
 * El indicador de la barra lateral (prompt-indicador-efectivo-inteligente.md).
 * TREASURY_VIEW_BRANCH: admin de sucursal ve la suya, Master la hereda vía
 * ALL_CAPABILITIES. Confirmar depósitos sigue siendo solo de Master
 * (TREASURY_MANAGE), acá no se toca.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const branchId = new URL(request.url).searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);
    requireBranchCapability(session, branchId, CAPABILITIES.TREASURY_VIEW_BRANCH);

    return ok(await getBranchCashPosition(branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
