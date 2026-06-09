import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { setOrderManualDiscount } from "@/modules/sales/service";
import { prisma } from "@/lib/prisma";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";

/**
 * PATCH /api/sales/orders/:id/discount — Aplica (o elimina) un descuento manual
 * a nivel de orden sobre el ticket en borrador.
 * Body: { discountAmount?: number } | { discountPercent?: number }.
 * Para eliminar el descuento, enviar discountAmount: 0.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await context.params;
    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id } });
    requireBranchCapability(session, order.branchId, CAPABILITIES.SALES_DRAFT_MANAGE);

    const body = (await request.json().catch(() => ({}))) as { discountAmount?: number; discountPercent?: number };
    const hasAmount = typeof body.discountAmount === "number" && Number.isFinite(body.discountAmount);
    const hasPercent = typeof body.discountPercent === "number" && Number.isFinite(body.discountPercent);
    if (!hasAmount && !hasPercent) {
      return fail("VALIDATION_ERROR", "Indique discountAmount o discountPercent.", 400);
    }

    const data = await setOrderManualDiscount({
      saleOrderId: id,
      actorUserId: session.userId,
      actorRole: session.roleCode,
      discountAmount: hasAmount ? body.discountAmount : undefined,
      discountPercent: hasPercent ? body.discountPercent : undefined,
    });
    return ok(data);
  } catch (error) {
    if (error instanceof Error && error.message === "DISCOUNT_LIMIT_EXCEEDED") {
      return fail("DISCOUNT_LIMIT_EXCEEDED", "Este descuento supera el límite permitido para tu rol.", 409, (error as unknown as { details?: unknown }).details);
    }
    if (error instanceof Error && error.message === "ORDER_NOT_DRAFT") {
      return fail("ORDER_NOT_DRAFT", "Solo se puede aplicar descuento a un ticket en borrador.", 409);
    }
    if (error instanceof Error && error.message === "INVALID_DISCOUNT") {
      return fail("INVALID_DISCOUNT", "El descuento ingresado no es válido.", 400);
    }
    return toApiErrorResponse(error);
  }
}
