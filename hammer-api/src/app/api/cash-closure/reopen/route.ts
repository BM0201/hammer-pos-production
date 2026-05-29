import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { reopenCashClosure } from "@/modules/cash-closure/service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { assertBranchAccess } from "@/modules/security/rbac-helpers";
import { isMaster as checkIsMaster } from "@/modules/rbac/guards";
import { fail, ok } from "@/lib/api/response";

const reopenSchema = z.object({
  branchId: z.string().min(1),
  reason: z.string().optional(),
});

// POST: Reopen a closed cash session (MASTER/BRANCH_ADMIN only)
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const isMasterRole = checkIsMaster(session);
    const isBranchAdmin = session.branchMemberships.some(
      (m) => m.roleCode === "BRANCH_ADMIN"
    );

    if (!isMasterRole && !isBranchAdmin) {
      return fail("FORBIDDEN", "Solo MASTER o BRANCH_ADMIN pueden reabrir la caja", 403);
    }

    const body = await request.json();
    const parsed = reopenSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Datos inválidos", 400);
    }

    // Validate branch access using centralized helper
    assertBranchAccess(session, parsed.data.branchId);

    const result = await reopenCashClosure({
      branchId: parsed.data.branchId,
      actorUserId: session.userId,
      reason: parsed.data.reason,
    });

    return ok({
      ok: true,
      legacy: true,
      source: "CashClosure",
      closure: {
        id: result.closure.id,
        isReopened: result.closure.isReopened,
        reopenCount: result.closure.reopenCount,
        emergencySalesCount: result.closure.emergencySalesCount,
        maxEmergencySales: result.closure.maxEmergencySales,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "NO_CLOSURE_TO_REOPEN") {
        return fail("NOT_FOUND", "No hay cierre para reabrir hoy", 404);
      }
      if (error.message === "CLOSURE_PERMANENTLY_CLOSED") {
        return fail("CONFLICT", "El cierre es permanente, no se puede reabrir hasta mañana", 409);
      }
    }
    return toHttpErrorResponse(error);
  }
}
