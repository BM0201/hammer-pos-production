import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { normalizeNailStockGroups } from "@/modules/catalog/stock-group-crud";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    return ok(await normalizeNailStockGroups(session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
