import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { applyBatch } from "@/modules/pricing/price-update-batch-apply-service";

const bodySchema = z.object({ acknowledgeWarnings: z.boolean().default(false) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_EDIT_GLOBAL)) {
      return fail("FORBIDDEN", "No tienes permiso para aplicar cargas de precios.", 403);
    }

    const { id } = await context.params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload inválido.", 400, parsed.error.flatten());

    const result = await applyBatch(id, { acknowledgeWarnings: parsed.data.acknowledgeWarnings, actorUserId: session.userId });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
