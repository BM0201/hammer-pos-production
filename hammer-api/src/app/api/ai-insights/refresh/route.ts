import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import { refreshAllInsights } from "@/modules/ai-insights/service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);

    assertMaster(session);

    let branchId: string | undefined;
    let days = 30;

    try {
      const body = await req.json();
      branchId = body.branchId ?? undefined;
      days = body.days ?? 30;
    } catch {
      // No body is fine — use defaults
    }

    const data = await refreshAllInsights(branchId, days);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    console.error("[AI Insights] refresh error:", error);
    return toHttpErrorResponse(error);
  }
}
