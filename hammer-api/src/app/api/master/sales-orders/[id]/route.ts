import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getSaleOrderDetailForManagement } from "@/modules/sales/service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/master/sales-orders/[id]
 *
 * Devuelve el detalle completo de una factura/orden de venta para la vista de
 * auditoría del Centro de Comando: cabecera, cliente, items, pagos, vendedor,
 * totales e historial de auditoría. Reservado al rol master/admin.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const { id } = await params;
    const order = await getSaleOrderDetailForManagement(id);
    return ok({ order });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
