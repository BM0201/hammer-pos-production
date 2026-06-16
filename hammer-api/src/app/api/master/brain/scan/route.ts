import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { runBrainScan } from "@/modules/brain/engine";
import { scanBrainSchema } from "@/modules/brain/validators";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = scanBrainSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Parametros invalidos.", 400, parsed.error.flatten());
    }

    const data = await runBrainScan({ ...parsed.data, actorUserId: session.userId });
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
