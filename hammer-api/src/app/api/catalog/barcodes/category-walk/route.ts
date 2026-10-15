import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { listProductsWithoutBarcodeForCategoryWalk } from "@/modules/catalog/barcode-search-service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";

/**
 * GET /api/catalog/barcodes/category-walk?categoryId&branchId
 *
 * prompt-codigos-editar-eliminar.md Fase 3.2 — "Recorrer por categoría":
 * productos sin código de esa categoría, con stock primero.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const categoryId = url.searchParams.get("categoryId");
    const branchId = url.searchParams.get("branchId");
    if (!categoryId || !branchId) return fail("VALIDATION_ERROR", "categoryId y branchId son obligatorios.", 400);
    if (!hasBranchAccess(session, branchId)) return fail("FORBIDDEN", "No tenés acceso a esa sucursal.", 403);

    return ok(await listProductsWithoutBarcodeForCategoryWalk({ categoryId, branchId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
