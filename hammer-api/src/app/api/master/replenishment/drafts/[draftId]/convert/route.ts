import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { convertReplenishmentDraft } from "@/modules/inventory/replenishment-draft-service";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ draftId: string }> }
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);
    const { draftId } = await context.params;
    return ok(await convertReplenishmentDraft(draftId, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
