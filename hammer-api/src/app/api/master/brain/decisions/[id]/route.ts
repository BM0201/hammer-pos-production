import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { getBrainDecision } from "@/modules/brain/service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    const { id } = await context.params;
    return ok(await getBrainDecision(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
