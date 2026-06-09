import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getSaleOrderDetail } from "@/modules/sales/management-service";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok, fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/master/sales-management/:id — Detalle COMPLETO de una venta para la
 * página de factura/detalle (solo MASTER): cliente, vendedor, sucursal, líneas
 * de productos/servicios, totales y pagos.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const { id } = await context.params;
    const detail = await getSaleOrderDetail(id);
    if (!detail) {
      return fail("NOT_FOUND", "No se encontró la venta solicitada.", 404);
    }
    return ok(detail);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
