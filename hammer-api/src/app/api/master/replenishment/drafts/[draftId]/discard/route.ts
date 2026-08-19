import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { discardReplenishmentDraft } from "@/modules/inventory/replenishment-draft-service";

/** POST /api/master/replenishment/drafts/:draftId/discard — descarta el plan (Reposición v2, Fase 1.4) */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ draftId: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);
    const { draftId } = await context.params;
    return ok(await discardReplenishmentDraft(draftId, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
