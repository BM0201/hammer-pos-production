import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { listDiscountSuggestions } from "@/modules/discounts/service";
import { ok } from "@/lib/api/response";
import { parseListLimit } from "@/lib/api/list-limit";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const safeLimit = parseListLimit(url.searchParams.get("limit"), { default: 24, max: 50 });
    const data = await listDiscountSuggestions(safeLimit);
    return ok(data);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
