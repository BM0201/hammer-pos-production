import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { getTodayClosure, isAfterAutoCloseTime } from "@/modules/cash-closure/service";
import { assertBranchAccess } from "@/modules/security/rbac-helpers";
import { ok, fail } from "@/lib/api/response";

// GET: Check closure status for a branch
export async function GET(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const branchId = request.nextUrl.searchParams.get("branchId") ?? session.primaryBranchId;
    if (!branchId) {
      return fail("VALIDATION_ERROR", "branchId is required", 400);
    }

    // Validate branch access
    assertBranchAccess(session, branchId);

    const { closure, isClosed, canSell, legacy, source, operationalDay, openCashSessionCount, autoClosedPendingReviewCount } = await getTodayClosure(branchId);
    return ok({
      branchId,
      isClosed,
      canSell,
      isAfterAutoCloseTime: isAfterAutoCloseTime(),
      legacy,
      source,
      operationalDay: operationalDay ? {
        id: operationalDay.id,
        status: operationalDay.status,
        businessDate: operationalDay.businessDate.toISOString(),
        openedAt: operationalDay.openedAt.toISOString(),
        closedAt: operationalDay.closedAt?.toISOString() ?? null,
      } : null,
      openCashSessionCount,
      autoClosedPendingReviewCount,
      closure: closure ? {
        id: closure.id,
        closureType: closure.closureType,
        totalSales: closure.totalSales.toString(),
        transactionCount: closure.transactionCount,
        isReopened: closure.isReopened,
        emergencySalesCount: closure.emergencySalesCount,
        maxEmergencySales: closure.maxEmergencySales,
        isPermanentlyClosed: closure.isPermanentlyClosed,
        legacy: true,
        source: "CashClosure",
      } : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return fail("UNAUTHENTICATED", "Unauthorized", 401);
    }
    return fail("INTERNAL_ERROR", "Error al obtener estado de cierre", 500);
  }
}
