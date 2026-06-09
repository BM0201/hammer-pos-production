import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { markSaleOrderAsTest } from "@/modules/sales/management-service";
import { requireCsrf } from "@/modules/security/csrf";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok, fail } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/master/sales-management/:id/test — Marca o desmarca una venta como
 * "de prueba" (solo MASTER). Body: { isTest: boolean, reason?: string }.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);
    await requireCsrf(request, session);

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { isTest?: boolean; reason?: string };
    if (typeof body.isTest !== "boolean") {
      return fail("VALIDATION_ERROR", "Falta el campo isTest (boolean).", 400);
    }

    const updated = await markSaleOrderAsTest({
      saleOrderId: id,
      actorUserId: session!.userId,
      isTest: body.isTest,
      reason: body.reason ?? null,
    });
    return ok({ id: updated.id, isTest: updated.isTest });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
