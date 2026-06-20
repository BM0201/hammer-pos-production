import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getReplenishmentDraft } from "@/modules/inventory/replenishment-draft-service";

export async function GET(_req: Request, context: { params: Promise<{ draftId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    const { draftId } = await context.params;
    return ok(await getReplenishmentDraft(draftId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
