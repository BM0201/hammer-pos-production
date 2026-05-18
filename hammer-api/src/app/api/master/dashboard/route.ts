import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getMasterDashboardSummary } from "@/modules/dashboard/service";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";

/**
 * GET /api/master/dashboard — Master command center dashboard summary.
 * Returns consolidated metrics across all active branches.
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const summary = await getMasterDashboardSummary();
    return ok(summary);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}