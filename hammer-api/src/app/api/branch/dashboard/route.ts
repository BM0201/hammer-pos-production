import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import {
  getBranchAdminDashboardSummary,
  getCashierDashboardSummary,
  getSalesDashboardSummary,
  getWarehouseDashboardSummary,
} from "@/modules/dashboard/service";
import { listPendingTransports } from "@/modules/transport/service";
import { toHttpErrorResponse } from "@/lib/http";

/**
 * GET /api/branch/dashboard?role=<roleCode>[&branchId=...]
 *
 * Returns the branch-level dashboard summary for the authenticated session.
 * Optional `role` parameter forces a specific dashboard variant (admin/sales/cashier/warehouse).
 * The `branchId` parameter is optional; if omitted the request uses the session's primary branch.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(req.url);
    const role = url.searchParams.get("role") ?? session!.roleCode;
    const requestedBranchId = url.searchParams.get("branchId") ?? undefined;
    const primaryBranchId = requestedBranchId ?? session!.primaryBranchId ?? session!.branchIds[0];

    switch (role) {
      case "SALES": {
        if (!primaryBranchId) {
          return NextResponse.json({ error: "No branch assigned" }, { status: 400 });
        }
        const summary = await getSalesDashboardSummary(primaryBranchId, session!.userId);
        return NextResponse.json({ kind: "SALES", summary });
      }
      case "CASHIER": {
        if (!primaryBranchId) {
          return NextResponse.json({ error: "No branch assigned" }, { status: 400 });
        }
        const summary = await getCashierDashboardSummary(primaryBranchId);
        return NextResponse.json({ kind: "CASHIER", summary });
      }
      case "WAREHOUSE": {
        if (!primaryBranchId) {
          return NextResponse.json({ error: "No branch assigned" }, { status: 400 });
        }
        const summary = await getWarehouseDashboardSummary(primaryBranchId);
        return NextResponse.json({ kind: "WAREHOUSE", summary });
      }
      case "BRANCH_ADMIN":
      default: {
        const adminBranchIds = Array.from(
          new Set(
            session!.branchMemberships
              .filter((item) => item.roleCode === "BRANCH_ADMIN")
              .map((item) => item.branchId),
          ),
        );
        const effectiveBranchIds = adminBranchIds.length ? adminBranchIds : session!.branchIds;
        const [summary, pendingTransports] = await Promise.all([
          getBranchAdminDashboardSummary(effectiveBranchIds),
          listPendingTransports(effectiveBranchIds),
        ]);
        return NextResponse.json({
          kind: "BRANCH_ADMIN",
          summary,
          pendingTransports: pendingTransports.map((t) => ({
            id: t.id,
            customerName: t.customerName,
            status: t.status,
            saleOrderNumber: t.saleOrder.orderNumber,
            price: typeof t.price === "object" && t.price !== null && "toNumber" in t.price ? (t.price as { toNumber: () => number }).toNumber() : t.price,
            reference: t.reference,
            scheduledPaymentTime: t.scheduledPaymentTime,
          })),
        });
      }
    }
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
