import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { getTodayClosure, isAfterAutoCloseTime } from "@/modules/cash-closure/service";

// GET: Check closure status for a branch
export async function GET(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const branchId = request.nextUrl.searchParams.get("branchId") ?? session.primaryBranchId;
    if (!branchId) {
      return NextResponse.json({ message: "branchId is required" }, { status: 400 });
    }

    const { closure, isClosed, canSell } = await getTodayClosure(branchId);
    return NextResponse.json({
      ok: true,
      branchId,
      isClosed,
      canSell,
      isAfterAutoCloseTime: isAfterAutoCloseTime(),
      closure: closure ? {
        id: closure.id,
        closureType: closure.closureType,
        totalSales: closure.totalSales.toString(),
        transactionCount: closure.transactionCount,
        isReopened: closure.isReopened,
        emergencySalesCount: closure.emergencySalesCount,
        maxEmergencySales: closure.maxEmergencySales,
        isPermanentlyClosed: closure.isPermanentlyClosed,
      } : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ message: "Error al obtener estado de cierre" }, { status: 500 });
  }
}
