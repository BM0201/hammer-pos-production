import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { listSaleOrdersForManagement } from "@/modules/sales/service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/master/sales-orders?branchId=&date=YYYY-MM-DD
 *
 * Lista las facturas/órdenes para gestión desde el Centro de Comando.
 * Reservado al rol master/admin. Sin filtros, devuelve las del día (Managua)
 * de todas las sucursales. Cada fila indica si puede anularse.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    const date = searchParams.get("date");

    const orders = await listSaleOrdersForManagement({
      branchId,
      date,
      // El master puede ver todas las sucursales; si se pasa branchId, se filtra.
      includeAllBranches: !branchId,
    });
    return ok({ orders });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
