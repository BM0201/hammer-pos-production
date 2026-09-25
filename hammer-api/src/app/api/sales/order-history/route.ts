import { fail, ok } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { canInBranch, isMaster } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { listSaleOrdersForManagement, canViewSalesHistoryForBranch } from "@/modules/sales/service";

/**
 * GET /api/sales/order-history?branchId=&date=&status=&search=&page=
 *
 * Hermana de GET /api/master/sales-orders (que exige assertMaster) para el
 * historial de ventas EN SUCURSAL (prompt-historial-sucursal.md Fase 1.1).
 * branchId es obligatorio: a diferencia de la ruta master, esta nunca lista
 * todas las sucursales — evita el error de simplemente "relajar" el guard
 * de la ruta master.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    if (!branchId) {
      return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);
    }
    if (!canViewSalesHistoryForBranch(isMaster(session), canInBranch(session, branchId, CAPABILITIES.SALES_VIEW))) {
      return fail("FORBIDDEN", "No tienes acceso al historial de esta sucursal.", 403);
    }

    const date = searchParams.get("date");
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const page = Number(searchParams.get("page") ?? 1);

    const result = await listSaleOrdersForManagement({
      branchId,
      date,
      includeAllBranches: false,
      status,
      search,
      page,
    });
    return ok(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
