import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import {
  getBranchAdminDashboardSummary,
  getCashierDashboardSummary,
  getSalesDashboardSummary,
  getWarehouseDashboardSummary,
} from "@/modules/dashboard/service";
import { assertBranchDashboardModuleEnabled, resolveBranchDashboardAccess } from "@/modules/dashboard/access";
import { getBranchModuleConfig } from "@/modules/branch-config/service";
import { listPendingTransports } from "@/modules/transport/service";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/branch/dashboard[?branchId=...]
 *
 * Returns the branch-level dashboard summary for the authenticated session.
 * The client cannot choose a role. The dashboard view is derived from the
 * authenticated user's actual branch membership/global role.
 * The `branchId` parameter is only a selector and is validated before use.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(req.url);
    const requestedBranchId = url.searchParams.get("branchId") ?? undefined;

    const access = resolveBranchDashboardAccess({
      session,
      requestedBranchId,
      moduleConfig: { enableCashier: true, enableDispatch: true },
    });

    const branch = await prisma.branch.findUnique({
      where: { id: access.branchId },
      select: { id: true, isActive: true },
    });
    if (!branch?.isActive) {
      throw new Error("FORBIDDEN_BRANCH");
    }

    const moduleConfig = await getBranchModuleConfig(access.branchId);
    assertBranchDashboardModuleEnabled(access.kind, moduleConfig);

    switch (access.kind) {
      case "SALES": {
        const summary = await getSalesDashboardSummary(access.branchId, session.userId);
        return ok({ kind: "SALES" as const, summary });
      }
      case "CASHIER": {
        const summary = await getCashierDashboardSummary(access.branchId);
        return ok({ kind: "CASHIER" as const, summary });
      }
      case "WAREHOUSE": {
        const summary = await getWarehouseDashboardSummary(access.branchId);
        return ok({ kind: "WAREHOUSE" as const, summary });
      }
      case "BRANCH_ADMIN":
      default: {
        const adminBranchIds = Array.from(
          new Set(
            session.branchMemberships
              .filter((item) => item.roleCode === "BRANCH_ADMIN")
              .map((item) => item.branchId),
          ),
        );
        const effectiveBranchIds = requestedBranchId
          ? [access.branchId]
          : adminBranchIds.length
            ? adminBranchIds
            : [access.branchId];
        const [summary, pendingTransports] = await Promise.all([
          getBranchAdminDashboardSummary(effectiveBranchIds),
          listPendingTransports(effectiveBranchIds),
        ]);
        return ok({
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
    return toApiErrorResponse(error);
  }
}
