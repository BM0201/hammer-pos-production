
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { closeCashSessionSchema } from "@/modules/cash-session/validators";
import { closeCashSession, logCashSessionDenied } from "@/modules/cash-session/service";
import { prisma } from "@/lib/prisma";
import { isMaster } from "@/modules/rbac/guards";
import { toHttpErrorResponse } from "@/lib/http";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { PaymentStatus, SaleOrderStatus } from "@prisma/client";
import { getOperationalWindowForNow } from "@/modules/operations/service";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

const CONFLICT_REASONS = new Set([
  "CASH_SESSION_NOT_RECONCILING",
  "CASH_SESSION_UNRESOLVED_ORDERS",
  "CASH_SESSION_HAS_PENDING_PAYMENTS",
  "STALE_PENDING_PAYMENT_ORDERS",
]);
const CASH_DISCREPANCY_APPROVAL_THRESHOLD = 5;

export async function POST(request: Request) {
  let targetSessionId = "unknown";
  let targetBranchId: string | undefined;

  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = closeCashSessionSchema.safeParse(await request.json());
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

    if (
      !isMaster(session) &&
      !canInBranch(
        session,
        cashSession.physicalCashBox.branchId,
        CAPABILITIES.CASH_SESSION_OPERATE,
      )
    ) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId: cashSession.physicalCashBox.branchId,
        entityId: parsed.data.cashSessionId,
        reason: "FORBIDDEN_BRANCH",
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    // Only count orders within today's operational window — historical PENDING_PAYMENT
    // orders from past days must NOT block today's close (critical: no global count).
    const { start: windowStart, end: windowEnd } = getOperationalWindowForNow();
    const stalePendingOrders = await prisma.saleOrder.findMany({
      where: {
        branchId: cashSession.physicalCashBox.branchId,
        status: SaleOrderStatus.PENDING_PAYMENT,
        createdAt: { gte: windowStart, lt: windowEnd },
      },
      select: {
        id: true,
        orderNumber: true,
        grandTotal: true,
        createdAt: true,
        customer: { select: { displayName: true } },
      },
      take: 10,
      orderBy: { createdAt: "asc" },
    });

    if (stalePendingOrders.length > 0) {
      return fail(
        "STALE_PENDING_PAYMENT_ORDERS",
        "Hay órdenes con pago pendiente de hoy que deben resolverse antes de cerrar la caja.",
        409,
        stalePendingOrders,
      );
    }

    const pendingPayments = await prisma.payment.count({
      where: {
        cashSessionId: cashSession.id,
        status: { not: PaymentStatus.POSTED },
      },
    });

    if (pendingPayments > 0) {
      return fail("CONFLICT", "CASH_SESSION_HAS_PENDING_PAYMENTS", 409);
    }

    // For manual closes the cashier has physically counted the drawer.
    // We always close the session and record the difference for later review
    // in Día Operativo 360 — no approval gate needed here.
    const result = await closeCashSession({
      ...parsed.data,
      actorUserId: session.userId,
      allowedThreshold: CASH_DISCREPANCY_APPROVAL_THRESHOLD,
    });

    if (Math.abs(result.difference) > CASH_DISCREPANCY_APPROVAL_THRESHOLD) {
      return ok({
        ...result,
        warning: {
          code: "CASH_DIFFERENCE_RECORDED" as const,
          difference: result.difference,
          threshold: CASH_DISCREPANCY_APPROVAL_THRESHOLD,
        },
      });
    }

    return ok(result);
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
