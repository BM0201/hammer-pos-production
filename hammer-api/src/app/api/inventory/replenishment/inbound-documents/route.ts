import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getInboundDocuments } from "@/modules/inventory/replenishment-params-service";

/** GET /api/inventory/replenishment/inbound-documents?branchId= — vista "En camino" (Reposición v2) */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es requerido", 400);

    return ok(await getInboundDocuments(branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
