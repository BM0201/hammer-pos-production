import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { canPostMovement } from "@/modules/inventory/policy";
import { openingBalanceBulkSchema } from "@/modules/inventory/validators";
import { createOpeningBalanceBulk } from "@/modules/inventory/service";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = openingBalanceBulkSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    if (!hasBranchAccess(session, parsed.data.branchId)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    if (!canInBranch(session, parsed.data.branchId, CAPABILITIES.INVENTORY_MOVEMENT_POST)) {
      return fail("FORBIDDEN", "No tienes permiso para registrar carga inicial de inventario en esta sucursal.", 403);
    }

    if (!canPostMovement(session.roleCode, "ADJUSTMENT_IN") || !canPostMovement(session.roleCode, "ADJUSTMENT_OUT")) {
      return fail("FORBIDDEN", "Role not allowed to post this movement type.", 403);
    }

    return ok(await createOpeningBalanceBulk({ ...parsed.data, actorUserId: session.userId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
