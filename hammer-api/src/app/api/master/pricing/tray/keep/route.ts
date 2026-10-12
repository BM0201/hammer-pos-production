import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { keepPricingTraySelection } from "@/modules/pricing/tray-service";

const keepTraySchema = z.object({
  decisionIds: z.array(z.string().cuid()).min(1),
  note: z.string().min(5).max(500),
});

/**
 * C.1.2 (prompt-completo-pendientes-2026-10.md) — "mantener el precio
 * actual" desde la Bandeja. Cada decisión en SU PROPIA transacción — una
 * que se rechaza (bajo el costo, o ya resuelta) no tumba las demás.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_EDIT_GLOBAL)) {
      return fail("FORBIDDEN", "No tienes permiso para revisar precios desde la bandeja.", 403);
    }

    const parsed = keepTraySchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const result = await keepPricingTraySelection({
      decisionIds: parsed.data.decisionIds,
      note: parsed.data.note,
      actorUserId: session.userId,
    });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
