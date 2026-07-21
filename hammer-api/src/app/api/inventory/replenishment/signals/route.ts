import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getReplenishmentSignals } from "@/modules/inventory/replenishment-service";

/** GET /api/inventory/replenishment/signals?branchId= — Reposición v2, motor único (Fase 1.3) */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es requerido", 400);

    return ok(await getReplenishmentSignals(branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
