import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { canPostMovement } from "@/modules/inventory/policy";
import { manualInventoryAdjustmentSchema } from "@/modules/inventory/validators";
import { createManualInventoryAdjustment } from "@/modules/inventory/service";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = manualInventoryAdjustmentSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    if (!hasBranchAccess(session, parsed.data.branchId)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    if (!canInBranch(session, parsed.data.branchId, CAPABILITIES.INVENTORY_MOVEMENT_POST)) {
      return fail("FORBIDDEN", "No tienes permiso para registrar ajustes manuales de inventario en esta sucursal.", 403);
    }

    const requiredMovement = ["ADJUSTMENT_OUT", "DAMAGE"].includes(parsed.data.adjustmentType)
      ? "ADJUSTMENT_OUT"
      : parsed.data.adjustmentType === "RETURN"
        ? "RETURN_IN"
        : "ADJUSTMENT_IN";
    if (!canPostMovement(session.roleCode, requiredMovement)) {
      return fail("FORBIDDEN", "Role not allowed to post this movement type.", 403);
    }

    return ok(await createManualInventoryAdjustment({ ...parsed.data, actorUserId: session.userId }));
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") {
      return fail("CONFLICT", "Stock insuficiente para este ajuste.", 409);
    }
    if (error instanceof Error && error.message === "NO_EFFECTIVE_COST_FOR_MANUAL_ADJUSTMENT") {
      return fail("VALIDATION_ERROR", "No hay costo efectivo/WAC para registrar una entrada manual sin tocar costos.", 422);
    }
    return toHttpErrorResponse(error);
  }
}
