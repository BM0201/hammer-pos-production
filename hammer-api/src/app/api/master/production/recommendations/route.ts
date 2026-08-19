import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertProductionPermission } from "@/modules/auth/production-guard";
import { getProductionRecommendationsForBranch } from "@/modules/production/production-recommendation-service";
import { toHttpErrorResponse } from "@/lib/http";
import { fail, ok } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await assertProductionPermission(session, "production.dashboard.view");

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);

    return ok(await getProductionRecommendationsForBranch({ branchId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
