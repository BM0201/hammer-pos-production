import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { listSuggestionBatches } from "@/modules/reorder/service";

/** GET /api/master/reorder/batches — list suggestion batches */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const url = new URL(req.url);
    const batches = await listSuggestionBatches({
      branchId: url.searchParams.get("branchId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      suggestionType: url.searchParams.get("suggestionType") ?? undefined,
    });

    return ok(batches);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}