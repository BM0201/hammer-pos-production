import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { getBrainSummary } from "@/modules/brain/service";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok(await getBrainSummary());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
