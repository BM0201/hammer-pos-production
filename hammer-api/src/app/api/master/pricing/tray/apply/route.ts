import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { applyPricingTraySelection } from "@/modules/pricing/tray-service";

const applyTraySchema = z.object({
  decisionIds: z.array(z.string().cuid()).min(1),
  reason: z.string().max(500).optional(),
});

/**
 * §1.4 (prompt-motor-precios-lote-herencia-gobierno.md) — aplicar una
 * selección de la bandeja. Cada decisión en SU PROPIA transacción: si una
 * falla, las demás quedan aplicadas. NO se saltea assertPriceApplicable —
 * el bloqueo por precio bajo el costo interno sigue activo en lote.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_EDIT_GLOBAL)) {
      return fail("FORBIDDEN", "No tienes permiso para aplicar precios desde la bandeja.", 403);
    }

    const parsed = applyTraySchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const result = await applyPricingTraySelection({
      decisionIds: parsed.data.decisionIds,
      reason: parsed.data.reason,
      actorUserId: session.userId,
    });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
