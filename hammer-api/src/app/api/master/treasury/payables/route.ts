import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { listSupplierPayables } from "@/modules/purchase-orders/payables";

/**
 * Cuentas por pagar (prompt-cxp.md, Fase 4) — "Por pagar" en Tesorería y el
 * selector de orden en "Pagos desde cuentas". onlyOpen=true por defecto
 * (lo que de verdad hace falta para pagar/mostrar pendientes); ?onlyOpen=false
 * trae también las ya saldadas, para un historial completo si algún día hace falta.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const supplierId = url.searchParams.get("supplierId") ?? undefined;
    const branchId = url.searchParams.get("branchId") ?? undefined;
    const onlyOpen = url.searchParams.get("onlyOpen") !== "false";

    const payables = await listSupplierPayables({ supplierId, branchId, onlyOpen });
    return ok(payables);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
