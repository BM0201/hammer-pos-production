import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { setBranchPriceInBand } from "@/modules/pricing/branch-band-service";

const setPriceInBandSchema = z.object({
  productId: z.string().cuid(),
  branchId: z.string().cuid(),
  price: z.coerce.number().positive(),
  reason: z.string().max(500).optional(),
});

/**
 * §4.2 (prompt-motor-precios-lote-herencia-gobierno.md) — la sucursal
 * ajusta libre DENTRO de la banda de su categoría; lo que se pasa sale a
 * aprobación en vez de aplicarse. Permiso verificado CONTRA LA SUCURSAL
 * del precio, no global — un BRANCH_ADMIN no puede tocar precios de otra
 * sucursal por este camino.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = setPriceInBandSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    if (!isMaster(session) && !canInBranch(session, parsed.data.branchId, CAPABILITIES.PRICING_EDIT_BRANCH)) {
      return fail("FORBIDDEN", "No tienes permiso para editar precios en esta sucursal.", 403);
    }

    const result = await setBranchPriceInBand({
      productId: parsed.data.productId,
      branchId: parsed.data.branchId,
      price: parsed.data.price,
      reason: parsed.data.reason,
      actorUserId: session.userId,
    });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
