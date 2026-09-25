import { notFound, ok } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { canInBranch, isMaster } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { getSaleOrderDetailForManagement, canViewSalesHistoryForBranch } from "@/modules/sales/service";

/**
 * GET /api/sales/order-history/[id]
 *
 * Hermana de GET /api/master/sales-orders/[id] para el historial de
 * sucursal (prompt-historial-sucursal.md Fase 1.2). includeAuditHistory:
 * false — la auditoría es de Master, y evita esa consulta extra. Sin
 * acceso a la sucursal de la orden responde 404, no 403: no hay que
 * revelar que existe una orden de otra sucursal.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { id } = await params;
    const order = await getSaleOrderDetailForManagement(id, { includeAuditHistory: false });
    if (!canViewSalesHistoryForBranch(isMaster(session), canInBranch(session, order.branch.id, CAPABILITIES.SALES_VIEW))) {
      return notFound();
    }
    return ok({ order });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
