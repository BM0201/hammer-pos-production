import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
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
      return ok(counts);
    }

    const alerts = await listReorderAlerts({
      branchId: url.searchParams.get("branchId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      alertType: url.searchParams.get("alertType") ?? undefined,
      productId: url.searchParams.get("productId") ?? undefined,
      limit: parseInt(url.searchParams.get("limit") ?? "100"),
      offset: parseInt(url.searchParams.get("offset") ?? "0"),
    });

    return ok(alerts);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}