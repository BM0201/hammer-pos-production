import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { getActiveCashSessionSchema } from "@/modules/cash-session/validators";
import { getActiveCashSession, logCashSessionDenied } from "@/modules/cash-session/service";
import { toHttpErrorResponse } from "@/lib/http";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";

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
      return fail("VALIDATION_ERROR", "Invalid query", 400);
    }

    const canOperateCash = canInBranch(session, parsed.data.branchId, CAPABILITIES.CASH_SESSION_OPERATE);
    const canSubmitDirectSale = canInBranch(session, parsed.data.branchId, CAPABILITIES.SALES_SUBMIT_PAYMENT);

    if (!isMaster(session) && !canOperateCash && !canSubmitDirectSale) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        entityId: parsed.data.physicalCashBoxId ?? parsed.data.branchId,
        reason: "FORBIDDEN_ROLE",
        metadata: { role: session.roleCode },
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    if (!isMaster(session) && !canOperateCash && !canSubmitDirectSale) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        entityId: parsed.data.physicalCashBoxId ?? parsed.data.branchId,
        reason: "FORBIDDEN_BRANCH",
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const data = await getActiveCashSession(parsed.data);

    if (!data) {
      return ok(null);
    }

    // Determine if the current user is an authorized operator of this session.
    // Masters/Owners/SystemAdmins bypass the operator check; branch-level users
    // must be explicitly assigned as operators before they can collect payments.
    let canOperate = false;
    if (isMaster(session)) {
      canOperate = true;
    } else {
      const op = await prisma.cashSessionOperator.findFirst({
        where: {
          cashSessionId: data.id,
          userId: session.userId,
          isActive: true,
          revokedAt: null,
        },
        select: { id: true },
      });
      canOperate = Boolean(op);
    }

    return ok({ ...data, canOperate });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
