import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { clearBranchPriceExceptions } from "@/modules/pricing/branch-price-exception-service";

const followStandardSchema = z.object({
  productId: z.string().cuid(),
  branchIds: z.array(z.string().cuid()).min(1),
});

/**
 * §3.3 (prompt-motor-precios-lote-herencia-gobierno.md) — volver a seguir
 * el precio general: branchPrice, priceExceptionReason y priceExceptionAt
 * vuelven a null juntos, una transacción por sucursal, con audit
 * PRICE_EXCEPTION_CLEARED que registra el branchPrice descartado.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_EDIT_GLOBAL)) {
      return fail("FORBIDDEN", "No tienes permiso para editar precios.", 403);
    }

    const parsed = followStandardSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const result = await clearBranchPriceExceptions({
      productId: parsed.data.productId,
      branchIds: parsed.data.branchIds,
      actorUserId: session.userId,
    });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
