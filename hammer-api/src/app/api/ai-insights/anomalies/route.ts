import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import { getAnomalies } from "@/modules/ai-insights/service";
import { fail, ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    assertMaster(session);

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") ?? undefined;
    const days = parseInt(searchParams.get("days") ?? "7", 10);

    const data = await getAnomalies(branchId, days);
    return ok(data);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return fail("UNAUTHENTICATED", "Unauthorized", 401);
    }
    console.error("[AI Insights] anomalies error:", error);
    return fail("INTERNAL_ERROR", "Error al detectar anomalías", 500);
  }
}
