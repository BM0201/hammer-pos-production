import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { getSaleOrderDetail } from "@/modules/sales/management-service";
import { assertCanViewSaleInBranch } from "@/modules/sales/sales-log-access";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok, fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/branch/sales-log/:id — Detalle COMPLETO de una venta de la sucursal
 * del usuario: cliente, vendedor, líneas (producto, cantidad, precio), totales
 * y pagos.
 *
 * Seguridad: tras cargar la venta se valida que pertenezca a una sucursal a la
 * que el usuario tiene acceso (`assertCanViewSaleInBranch`). Si la venta es de
 * otra sucursal se responde NOT_FOUND para no revelar su existencia.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { id } = await context.params;
    const detail = await getSaleOrderDetail(id);
    if (!detail) {
      return fail("NOT_FOUND", "No se encontró la venta solicitada.", 404);
    }

    // Defensa en profundidad: la venta debe pertenecer a una sucursal accesible.
    try {
      assertCanViewSaleInBranch(session!, detail.branch.id);
    } catch {
      // No revelar la existencia de ventas de otras sucursales.
      return fail("NOT_FOUND", "No se encontró la venta solicitada.", 404);
    }

    return ok(detail);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
