import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { setSaleOrderVoided } from "@/modules/sales/management-service";
import { requireCsrf } from "@/modules/security/csrf";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok, fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/master/sales-management/:id/void — Anula (o restaura) una venta con
 * justificación (solo MASTER). Body: { voided: boolean, reason?: string }.
 * Al anular se requiere un motivo.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);
    await requireCsrf(request, session);

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { voided?: boolean; reason?: string };
    if (typeof body.voided !== "boolean") {
      return fail("VALIDATION_ERROR", "Falta el campo voided (boolean).", 400);
    }
    if (body.voided && !body.reason?.trim()) {
      return fail("VOID_REASON_REQUIRED", "Debe indicar un motivo para anular la venta.", 400);
    }

    const updated = await setSaleOrderVoided({
      saleOrderId: id,
      actorUserId: session!.userId,
      voided: body.voided,
      reason: body.reason ?? null,
    });
    return ok({ id: updated.id, voidedAt: updated.voidedAt, voidReason: updated.voidReason });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
