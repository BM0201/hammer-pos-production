import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { listPendingPaymentOrders } from "@/modules/payments/service";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_PAYMENTS_VIEW)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId") ?? "";

    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.CASH_PAYMENTS_VIEW)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const data = await listPendingPaymentOrders({
      branchId,
      includeAllBranches: isMaster(session) && !branchId,
    });

    return NextResponse.json({ data });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
