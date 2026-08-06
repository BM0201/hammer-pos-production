import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { listOperationalDays } from "@/modules/operations/service";
import { masterOperationalDaysSchema } from "@/modules/operations/validators";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    const url = new URL(request.url);
    const parsed = masterOperationalDaysSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Filtros invalidos.", 400, parsed.error.flatten());
    return ok(await listOperationalDays(parsed.data));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
