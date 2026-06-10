import { CashSessionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertBranchAccess } from "@/modules/auth/access";
import { getBranchSalesRealtimeSummary } from "@/modules/sales/realtime-sales-summary";
import { ok } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    if (!branchId) throw new Error("VALIDATION_ERROR: branchId is required");
    assertBranchAccess(session!, branchId);

    const [summary, activeCashSession] = await Promise.all([
      getBranchSalesRealtimeSummary(branchId),
      prisma.cashSession.findFirst({
        where: {
          status: { in: [CashSessionStatus.OPEN, CashSessionStatus.RECONCILING] },
          physicalCashBox: { branchId },
        },
        select: {
          id: true,
          status: true,
          openedAt: true,
          physicalCashBox: { select: { code: true, description: true } },
        },
        orderBy: { openedAt: "desc" },
      }),
    ]);

    return ok({
      summary: {
        ...summary,
        window: {
          start: summary.window.start.toISOString(),
          end: summary.window.end.toISOString(),
          timezone: summary.window.timezone,
        },
      },
      activeCashSession,
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
