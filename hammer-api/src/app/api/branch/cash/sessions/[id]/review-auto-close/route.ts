import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { prisma } from "@/lib/prisma";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { requireCsrf } from "@/modules/security/csrf";
import { reviewAutoClosedCashSessionSchema } from "@/modules/cash-session/validators";
import { reviewAutoClosedCashSession, logCashSessionDenied } from "@/modules/cash-session/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let targetBranchId: string | undefined;
  const { id } = await params;

  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const payload = await request.json();
    const parsed = reviewAutoClosedCashSessionSchema.safeParse({
      ...payload,
      cashSessionId: id,
    });
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const cashSession = await prisma.cashSession.findUniqueOrThrow({
      where: { id },
      include: { physicalCashBox: true },
    });
    targetBranchId = cashSession.physicalCashBox.branchId;

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE)) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: targetBranchId,
        entityId: id,
        reason: "FORBIDDEN_ROLE",
        metadata: { role: session.roleCode },
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    if (!isMaster(session) && !canInBranch(session, targetBranchId, CAPABILITIES.CASH_SESSION_OPERATE)) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: targetBranchId,
        entityId: id,
        reason: "FORBIDDEN_BRANCH",
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const data = await reviewAutoClosedCashSession({
      cashSessionId: parsed.data.cashSessionId,
      countedCashAmount: parsed.data.countedCashAmount,
      confirmOk: parsed.data.confirmOk,
      note: parsed.data.note,
      actorUserId: session.userId,
    });

    return ok(data);
  } catch (error) {
    if (error instanceof Error && error.message === "CASH_SESSION_NOT_PENDING_AUTO_REVIEW") {
      await logCashSessionDenied({
        actorUserId: (await getCurrentSession())?.userId,
        branchId: targetBranchId,
        entityId: id,
        reason: error.message,
      });
      return fail("CONFLICT", error.message, 409);
    }
    return toHttpErrorResponse(error);
  }
}
