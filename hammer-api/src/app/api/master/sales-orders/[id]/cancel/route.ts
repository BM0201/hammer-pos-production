import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { cancelSaleOrder } from "@/modules/sales/service";
import { logAuditEvent } from "@/modules/audit/service";
import { SALE_AUDIT_EVENTS } from "@/modules/sales/audit-events";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/master/sales-orders/[id]/cancel
 *
 * Anula (CANCELLED) una factura/orden de venta desde el Centro de Comando.
 * Reservado al rol master/admin. Requiere un motivo de anulación en el body:
 *   { "reason": "texto descriptivo" }
 *
 * La operación revierte inventario, anula pagos, actualiza el día operativo y
 * registra auditoría (ver cancelSaleOrder).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  try {
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session!);

    const { id } = await params;
    let body: { reason?: string } = {};
    try {
      body = (await request.json()) as { reason?: string };
    } catch {
      body = {};
    }

    const result = await cancelSaleOrder({
      orderId: id,
      actorUserId: session!.userId,
      reason: body.reason ?? "",
    });
    return ok(result);
  } catch (error) {
    // Auditoría del intento denegado/erróneo (best-effort, no interrumpe).
    if (session) {
      const { id } = await params.catch(() => ({ id: "unknown" }));
      await logAuditEvent({
        actorUserId: session.userId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_CANCEL_DENIED,
        entityType: "SaleOrder",
        entityId: id,
        metadataJson: { reason: error instanceof Error ? error.message : String(error) },
      }).catch(() => {});
    }
    return toHttpErrorResponse(error);
  }
}
