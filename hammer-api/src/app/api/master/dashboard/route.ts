import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getMasterDashboardSummary } from "@/modules/dashboard/service";
import { toHttpErrorResponse } from "@/lib/http";

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
    return NextResponse.json(summary);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
