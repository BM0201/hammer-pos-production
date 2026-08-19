import { CashSessionStatus } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { prisma } from "@/lib/prisma";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    const physicalCashBoxId = searchParams.get("physicalCashBoxId");
    if (!branchId) {
      return fail("VALIDATION_ERROR", "branchId requerido", 400);
    }

    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.CASH_SESSION_OPERATE)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const data = await prisma.cashSession.findMany({
      where: {
        status: CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW,
        requiresReview: true,
        physicalCashBox: {
          branchId,
          ...(physicalCashBoxId ? { id: physicalCashBoxId } : {}),
        },
      },
      include: {
        physicalCashBox: true,
        openedBy: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { autoClosedAt: "desc" },
      take: 25,
    });

    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
