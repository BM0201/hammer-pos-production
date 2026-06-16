import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { evaluateExecutedDecisions } from "@/modules/brain/outcomes";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const result = await evaluateExecutedDecisions({ limit: 100 });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
