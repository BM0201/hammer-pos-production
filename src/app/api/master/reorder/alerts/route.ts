import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { listReorderAlerts, getReorderAlertCounts } from "@/modules/reorder/service";

/** GET /api/master/reorder/alerts — list reorder alerts with optional filters */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const url = new URL(req.url);
    const countsOnly = url.searchParams.get("countsOnly") === "true";

    if (countsOnly) {
      const counts = await getReorderAlertCounts();
      return NextResponse.json({ data: counts });
    }

    const alerts = await listReorderAlerts({
      branchId: url.searchParams.get("branchId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      alertType: url.searchParams.get("alertType") ?? undefined,
      productId: url.searchParams.get("productId") ?? undefined,
      limit: parseInt(url.searchParams.get("limit") ?? "100"),
      offset: parseInt(url.searchParams.get("offset") ?? "0"),
    });

    return NextResponse.json({ data: alerts });
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
