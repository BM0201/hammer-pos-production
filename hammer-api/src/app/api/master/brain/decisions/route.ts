import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { listBrainDecisions } from "@/modules/brain/service";
import { decisionFiltersSchema } from "@/modules/brain/validators";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const parsed = decisionFiltersSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Filtros invalidos.", 400, parsed.error.flatten());
    }

    const data = await listBrainDecisions(parsed.data);
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
