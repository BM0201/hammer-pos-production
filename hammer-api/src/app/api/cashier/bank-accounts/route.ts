import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { isMaster } from "@/modules/rbac/guards";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { listBankAccountsForCashier } from "@/modules/treasury/service";

/**
 * Selector de cuenta destino para el cajero (módulo Destino del efectivo,
 * "Alguien lo lleva al banco hoy"). Deliberadamente angosto: a diferencia
 * de /api/master/treasury/bank-accounts (que devuelve TODAS las cuentas
 * activas — SETTLEMENT, SAFE, y las CUSTODY de otras personas con sus
 * nombres), esto solo expone cuentas BANK de la sucursal, sin saldos.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const branchId = new URL(request.url).searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);

    return ok(await listBankAccountsForCashier(branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
