import { InventoryMovementType } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { previewInventoryMovement } from "@/modules/inventory/service";
import { toHttpErrorResponse } from "@/lib/http";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { ok, fail } from "@/lib/api/response";

/**
 * prompt-kardex-ux-wac.md, Parte 2.2 — GET (no muta nada) para que el
 * formulario de Movimientos/Kardex pueda mostrar "WAC actual → WAC
 * nuevo" ANTES de enviar. Mismos guards de acceso que
 * POST /api/inventory/movements (solo quien puede postear el movimiento
 * puede ver su efecto en el WAC — es un dato de costo sensible).
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    const productId = searchParams.get("productId");
    const movementType = searchParams.get("movementType") as InventoryMovementType | null;
    const quantity = Number(searchParams.get("quantity"));
    const unitCost = Number(searchParams.get("unitCost"));

    if (!branchId || !productId || !movementType) {
      return fail("VALIDATION_ERROR", "branchId, productId y movementType son obligatorios.", 400);
    }
    if (!Object.values(InventoryMovementType).includes(movementType)) {
      return fail("VALIDATION_ERROR", "Invalid movementType", 400);
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
      return fail("VALIDATION_ERROR", "quantity y unitCost deben ser números válidos.", 400);
    }

    if (!hasBranchAccess(session, branchId)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }
    if (!canInBranch(session, branchId, CAPABILITIES.INVENTORY_MOVEMENT_POST)) {
      return fail("FORBIDDEN", "No tienes permiso para registrar movimientos manuales de inventario en esta sucursal.", 403);
    }

    const preview = await previewInventoryMovement({ branchId, productId, movementType, quantity, unitCost });
    return ok(preview);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
