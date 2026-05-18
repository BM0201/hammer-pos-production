import { CashSessionStatus } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { getActiveCashSession, logCashSessionDenied } from "@/modules/cash-session/service";
import { prisma } from "@/lib/prisma";
import { ok, fail, forbidden, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { z } from "zod";

/**
 * Phase 4 fix: GET /api/cashier/cash-sessions/active
 *
 * Supports two modes:
 * 1. Specific: ?branchId=...&physicalCashBoxId=... (original)
 * 2. Branch-wide: ?branchId=... (new for direct-sale flow)
 *    Finds any OPEN session from active cash boxes in the branch.
 */
const activeSessionQuerySchema = z.object({
  branchId: z.string().cuid(),
  physicalCashBoxId: z.string().cuid().optional(),
});

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const parsed = activeSessionQuerySchema.safeParse({
      branchId: searchParams.get("branchId") ?? undefined,
      physicalCashBoxId: searchParams.get("physicalCashBoxId") ?? undefined,
    });

    if (!parsed.success) {
      return validationFail(parsed.error.flatten());
    }

    const { branchId, physicalCashBoxId } = parsed.data;

    // RBAC: user must have CASH_SESSION_OPERATE or SALES_SUBMIT_PAYMENT in some branch
    const hasCashPermission = canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE);
    const hasSalesPermission = canInAnyAssignedBranch(session, CAPABILITIES.SALES_SUBMIT_PAYMENT);
    if (!hasCashPermission && !hasSalesPermission && !isMaster(session)) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId,
        entityId: physicalCashBoxId ?? branchId,
        reason: "FORBIDDEN_ROLE",
        metadata: { role: session.roleCode },
      });
      return forbidden("No tiene permisos de caja o venta en ninguna sucursal");
    }

    // Branch-level access check
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.CASH_SESSION_OPERATE) && !canInBranch(session, branchId, CAPABILITIES.SALES_SUBMIT_PAYMENT)) {
      await logCashSessionDenied({
        actorUserId: session.userId,
        branchId,
        entityId: physicalCashBoxId ?? branchId,
        reason: "FORBIDDEN_BRANCH",
      });
      return forbidden("No tiene permisos en esta sucursal");
    }

    // Mode 1: Specific cash box
    if (physicalCashBoxId) {
      const data = await getActiveCashSession({ branchId, physicalCashBoxId });
      if (!data) {
        return fail("NO_ACTIVE_CASH_SESSION", "No hay sesión de caja abierta para esta caja.", 404);
      }
      return ok(data);
    }

    // Mode 2: Branch-wide — find any OPEN session from active cash boxes
    const activeSession = await prisma.cashSession.findFirst({
      where: {
        status: CashSessionStatus.OPEN,
        physicalCashBox: {
          branchId,
          isActive: true,
        },
      },
      include: {
        physicalCashBox: true,
        openedBy: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { openedAt: "desc" },
    });

    if (!activeSession) {
      return fail("NO_ACTIVE_CASH_SESSION", "No hay sesión de caja abierta para registrar venta directa.", 404);
    }

    return ok(activeSession);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
