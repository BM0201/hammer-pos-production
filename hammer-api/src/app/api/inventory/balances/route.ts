import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertBranchAccess } from "@/modules/auth/access";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { listInventoryBalances } from "@/modules/inventory/service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    const productId = searchParams.get("productId") ?? undefined;

    if (!branchId) {
      return fail("VALIDATION_ERROR", "branchId is required", 400);
    }

    assertBranchAccess(session, branchId);

    // Consulta puntual de UN producto (ej. el POS validando stock antes de
    // vender, fetchStockForProduct) queda abierta a cualquier rol de la
    // sucursal — la necesita SALES/CASHIER para operar el POS. Listar TODO
    // el inventario (sin productId) es la pantalla de gestión: antes solo
    // el sidebar ocultaba el link a rangos bajos, pero la API no lo
    // exigía — cualquiera con acceso a la sucursal podía verla completa
    // (incluido stock cero) entrando directo por la URL. Ahora exige el
    // mismo permiso que ya decide si el link aparece en el menú.
    if (!productId) {
      requireBranchCapability(session, branchId, CAPABILITIES.BRANCH_INVENTORY_VIEW);
    }

    const data = await listInventoryBalances({ branchId, productId });
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
