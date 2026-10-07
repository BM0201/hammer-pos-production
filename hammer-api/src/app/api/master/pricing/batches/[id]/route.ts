import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { previewBatch } from "@/modules/pricing/price-update-batch-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_VIEW)) {
      return fail("FORBIDDEN", "No tienes permiso para ver las cargas de precios.", 403);
    }

    const { id } = await context.params;
    return ok(await previewBatch(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
