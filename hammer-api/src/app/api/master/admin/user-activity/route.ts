import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getUserActivitySnapshot } from "@/modules/auth/presence-service";

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const activity = await getUserActivitySnapshot();
    return ok(activity);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
