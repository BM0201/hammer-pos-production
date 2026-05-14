import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
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

    return NextResponse.json({ data: batches });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
