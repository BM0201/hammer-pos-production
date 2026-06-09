import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import { getClosureReports } from "@/modules/cash-closure/service";
import { fail, ok } from "@/lib/api/response";

// GET: Fetch closure reports (MASTER only)
export async function GET(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    assertMaster(session);

    const branchId = request.nextUrl.searchParams.get("branchId") ?? undefined;
    const startDate = request.nextUrl.searchParams.get("startDate") ?? undefined;
    const endDate = request.nextUrl.searchParams.get("endDate") ?? undefined;
    const page = parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10);
    const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);

    const result = await getClosureReports({ branchId, startDate, endDate, page, limit });

    return ok({
      legacy: true,
      source: "CashClosure",
      closures: result.closures.map((c) => ({
        id: c.id,
        branchId: c.branchId,
        branchCode: c.branch.code,
        branchName: c.branch.name,
        closureDate: c.closureDate.toISOString(),
        closedAt: c.closedAt.toISOString(),
        closureType: c.closureType,
        totalSales: c.totalSales.toString(),
        transactionCount: c.transactionCount,
        cashTotal: c.cashTotal.toString(),
        cardTotal: c.cardTotal.toString(),
        transferTotal: c.transferTotal.toString(),
        creditTotal: c.creditTotal.toString(),
        mixedTotal: c.mixedTotal.toString(),
        productsSold: c.productsSold,
        isReopened: c.isReopened,
        reopenedAt: c.reopenedAt?.toISOString() ?? null,
        reopenCount: c.reopenCount,
        emergencySalesCount: c.emergencySalesCount,
        maxEmergencySales: c.maxEmergencySales,
        isPermanentlyClosed: c.isPermanentlyClosed,
        legacy: true,
        source: "CashClosure",
        logs: c.logs.map((l) => ({
          id: l.id,
          action: l.action,
          performedByUserId: l.performedByUserId,
          metadataJson: l.metadataJson,
          createdAt: l.createdAt.toISOString(),
        })),
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      currentPage: result.currentPage,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return fail("UNAUTHENTICATED", "Unauthorized", 401);
    }
    return fail("INTERNAL_ERROR", "Error al obtener reportes de cierre", 500);
  }
}
