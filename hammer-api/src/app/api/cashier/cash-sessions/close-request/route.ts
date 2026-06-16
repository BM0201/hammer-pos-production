import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requestCloseCashSessionSchema } from "@/modules/cash-session/validators";
import { logCashSessionDenied, requestCloseCashSession } from "@/modules/cash-session/service";
import { prisma } from "@/lib/prisma";
import { isMaster } from "@/modules/rbac/guards";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { fail, ok } from "@/lib/api/response";

const CONFLICT_REASONS = new Set([
  "CASH_SESSION_NOT_OPEN",
  "CASH_SESSION_UNRESOLVED_ORDERS",
  "STALE_PENDING_PAYMENT_ORDERS",
  "CASH_SESSION_HAS_PENDING_PAYMENTS",
]);

export async function POST(request: Request) {
  let targetSessionId = "unknown";
  let targetBranchId: string | undefined;

  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = requestCloseCashSessionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
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
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    if (!isMaster(session) && !canInBranch(session, cashSession.physicalCashBox.branchId, CAPABILITIES.CASH_SESSION_OPERATE)) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: cashSession.physicalCashBox.branchId,
        entityId: parsed.data.cashSessionId,
        reason: "FORBIDDEN_BRANCH",
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const data = await requestCloseCashSession({
      ...parsed.data,
      actorUserId: session.userId,
    });

    return ok(data);
  } catch (error) {
    if (error instanceof Error && CONFLICT_REASONS.has(error.message)) {
      const session = await getCurrentSession();
      await logCashSessionDenied({
        actorUserId: session?.userId,
        branchId: targetBranchId,
        entityId: targetSessionId,
        reason: error.message,
      });
      if (error.message === "STALE_PENDING_PAYMENT_ORDERS") {
        const details = (error as Error & { pendingOrders?: unknown }).pendingOrders;
        return fail("STALE_PENDING_PAYMENT_ORDERS", "Hay órdenes con pago pendiente que deben resolverse antes de cerrar la caja.", 409, details);
      }
      return fail("CONFLICT", error.message, 409);
    }
    return toHttpErrorResponse(error);
  }
}
