import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requestCloseCashSessionSchema } from "@/modules/cash-session/validators";
import { logCashSessionDenied, requestCloseCashSession } from "@/modules/cash-session/service";
import { prisma } from "@/lib/prisma";
import { isMaster } from "@/modules/rbac/guards";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";

const CONFLICT_REASONS = new Set(["CASH_SESSION_NOT_OPEN", "CASH_SESSION_UNRESOLVED_ORDERS"]);

export async function POST(request: Request) {
  let targetSessionId = "unknown";
  let targetBranchId: string | undefined;

  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const parsed = requestCloseCashSessionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
    }

    targetSessionId = parsed.data.cashSessionId;

    const cashSession = await prisma.cashSession.findUniqueOrThrow({
      where: { id: parsed.data.cashSessionId },
      include: { physicalCashBox: true },
    });

    targetBranchId = cashSession.physicalCashBox.branchId;

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE)) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: cashSession.physicalCashBox.branchId,
        entityId: parsed.data.cashSessionId,
        reason: "FORBIDDEN_ROLE",
        metadata: { role: session.roleCode },
      });
      return NextResponse.json({ message: "Forbidden", reason: "FORBIDDEN_ROLE" }, { status: 403 });
    }

    if (!isMaster(session) && !canInBranch(session, cashSession.physicalCashBox.branchId, CAPABILITIES.CASH_SESSION_OPERATE)) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: cashSession.physicalCashBox.branchId,
        entityId: parsed.data.cashSessionId,
        reason: "FORBIDDEN_BRANCH",
      });
      return NextResponse.json({ message: "Forbidden", reason: "FORBIDDEN_BRANCH" }, { status: 403 });
    }

    const data = await requestCloseCashSession({
      ...parsed.data,
      actorUserId: session.userId,
    });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && CONFLICT_REASONS.has(error.message)) {
      const session = await getCurrentSession();
      await logCashSessionDenied({
        actorUserId: session?.userId,
        branchId: targetBranchId,
        entityId: targetSessionId,
        reason: error.message,
      });
      return NextResponse.json({ message: error.message, reason: error.message }, { status: 409 });
    }
    return toHttpErrorResponse(error);
  }
}
