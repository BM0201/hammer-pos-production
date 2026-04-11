import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { refreshAllInsights } from "@/modules/ai-insights/service";

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const globalRoles = session.globalRoles as unknown as string[];
    if (!globalRoles.includes("MASTER") && !globalRoles.includes("SYSTEM_ADMIN")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

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
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    console.error("[AI Insights] refresh error:", error);
    return NextResponse.json({ message: "Error al recalcular insights" }, { status: 500 });
  }
}
