import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { executeAutoClosureForAllBranches } from "@/modules/cash-closure/service";

// POST: Manually trigger auto-closure (MASTER/SYSTEM_ADMIN only)
export async function POST() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const globalRoles = session.globalRoles as unknown as string[];
    if (!globalRoles.includes("MASTER") && !globalRoles.includes("SYSTEM_ADMIN")) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const results = await executeAutoClosureForAllBranches();
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ message: "Error al ejecutar cierre automático" }, { status: 500 });
  }
}
