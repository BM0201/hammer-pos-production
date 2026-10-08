import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { revertPriceUpdateBatch } from "@/modules/pricing/price-update-revert-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_EDIT_GLOBAL)) {
      return fail("FORBIDDEN", "No tienes permiso para revertir cargas de precios.", 403);
    }

    const { id } = await context.params;
    const result = await revertPriceUpdateBatch(id, session.userId);
    return ok(result, 201);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
