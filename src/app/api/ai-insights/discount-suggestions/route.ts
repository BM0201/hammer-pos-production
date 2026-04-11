import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { getDiscountSuggestions } from "@/modules/ai-insights/service";

export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const globalRoles = session.globalRoles as unknown as string[];
    if (!globalRoles.includes("MASTER") && !globalRoles.includes("SYSTEM_ADMIN")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") ?? undefined;
    const days = parseInt(searchParams.get("days") ?? "30", 10);

    const data = await getDiscountSuggestions(branchId, days);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    console.error("[AI Insights] discount-suggestions error:", error);
    return NextResponse.json({ message: "Error al generar sugerencias de descuento" }, { status: 500 });
  }
}
