import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import { getPatterns, getRecommendations } from "@/modules/ai-insights/service";
import { fail, ok } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    assertMaster(session);

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") ?? undefined;
    const days = parseInt(searchParams.get("days") ?? "30", 10);

    const [patterns, recommendations] = await Promise.all([
      getPatterns(branchId, days),
      getRecommendations(branchId, days),
    ]);

    return ok({ patterns, recommendations });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return fail("UNAUTHENTICATED", "Unauthorized", 401);
    }
    console.error("[AI Insights] patterns error:", error);
    return fail("INTERNAL_ERROR", "Error al analizar patrones", 500);
  }
}
