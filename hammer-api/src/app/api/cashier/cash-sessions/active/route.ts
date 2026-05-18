import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { getActiveCashSessionSchema } from "@/modules/cash-session/validators";
import { getActiveCashSession, logCashSessionDenied } from "@/modules/cash-session/service";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const parsed = getActiveCashSessionSchema.safeParse({
      branchId: searchParams.get("branchId"),
      physicalCashBoxId: searchParams.get("physicalCashBoxId"),
    });

    if (!parsed.success) {
      return NextResponse.json({ message: "Invalid query", issues: parsed.error.issues }, { status: 400 });
    }

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE)) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        entityId: parsed.data.physicalCashBoxId,
        reason: "FORBIDDEN_ROLE",
        metadata: { role: session.roleCode },
      });
      return NextResponse.json({ message: "Forbidden", reason: "FORBIDDEN_ROLE" }, { status: 403 });
    }

    if (!isMaster(session) && !canInBranch(session, parsed.data.branchId, CAPABILITIES.CASH_SESSION_OPERATE)) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        entityId: parsed.data.physicalCashBoxId,
        reason: "FORBIDDEN_BRANCH",
      });
      return NextResponse.json({ message: "Forbidden", reason: "FORBIDDEN_BRANCH" }, { status: 403 });
    }

    const data = await getActiveCashSession(parsed.data);
    return NextResponse.json({ data });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
