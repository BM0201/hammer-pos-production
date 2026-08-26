import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { isMaster } from "@/modules/rbac/guards";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { prisma } from "@/lib/prisma";
import { listBranchPeopleForCashHandover } from "@/modules/treasury/service";

/**
 * Lista de personas para "¿a quién se lo llevo?" / "¿quién lo recibe?" en
 * Destino del efectivo (§A.4, prompt-destino-efectivo-rediseno.md). A
 * diferencia de /api/branches/[id]/members (solo UserBranchRole), esta une
 * membresía de sucursal con globalRole MASTER/OWNER: Master, si solo vive en
 * User.globalRole sin membresía de sucursal, no aparecía en ningún selector
 * — y "yo se lo llevo a alguien" existe justamente para poder entregarle a
 * Master. Mismo permiso y doble verificación que send-deposit/route.ts.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const branchId = new URL(request.url).searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);

    if (!canInAnyAssignedBranch(session, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);
    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.CASH_SESSION_OPERATE)) return fail("FORBIDDEN", "Forbidden", 403);

    return ok(await listBranchPeopleForCashHandover(prisma, branchId, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
