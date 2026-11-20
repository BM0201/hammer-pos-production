import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { getBranchDayView } from "@/modules/dashboard/service";
import { resolveBranchDashboardAccess } from "@/modules/dashboard/access";
import { getBranchModuleConfig } from "@/modules/branch-config/service";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/branch/dashboard[?branchId=...] — "Mi día" de la caja.
 *
 * Una sola vista para todos los roles: cada sección se incluye según lo que
 * el usuario puede hacer en esa sucursal. `branchId` es solo un selector y se
 * valida contra las membresías (resolveBranchDashboardAccess).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const requestedBranchId = new URL(req.url).searchParams.get("branchId") ?? undefined;
    const { branchId } = resolveBranchDashboardAccess({
      session,
      requestedBranchId,
      moduleConfig: { enableCashier: true, enableDispatch: true },
    });

    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { isActive: true } });
    if (!branch?.isActive) {
      throw new Error("FORBIDDEN_BRANCH");
    }

    const moduleConfig = await getBranchModuleConfig(branchId);
    const can = (capability: Parameters<typeof canInBranch>[2]) => canInBranch(session, branchId, capability);
    const dispatch = moduleConfig.enableDispatch && can(CAPABILITIES.DISPATCH_VIEW);

    const view = await getBranchDayView(branchId, session.userId, {
      cash: moduleConfig.enableCashier && (can(CAPABILITIES.CASH_SESSION_USE) || can(CAPABILITIES.PAYMENT_QUEUE_VIEW)),
      payments: moduleConfig.enableCashier && can(CAPABILITIES.PAYMENT_QUEUE_VIEW),
      myDrafts: can(CAPABILITIES.POS_VIEW),
      dispatches: dispatch,
      transports: dispatch,
      approvals: can(CAPABILITIES.APPROVAL_REQUEST_REVIEW),
    });

    return ok(view);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
