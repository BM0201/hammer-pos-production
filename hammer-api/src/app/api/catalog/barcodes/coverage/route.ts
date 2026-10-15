import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { getBarcodeCoverage } from "@/modules/catalog/barcode-search-service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";

/**
 * GET /api/catalog/barcodes/coverage?branchId&categoryId
 *
 * prompt-codigos-editar-eliminar.md Fase 3.2 — "Productos con código: 1,412
 * de 3,705 · 38 %", filtrable por sucursal y categoría.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId") ?? undefined;
    if (branchId && !hasBranchAccess(session, branchId)) return fail("FORBIDDEN", "No tenés acceso a esa sucursal.", 403);
    const categoryId = url.searchParams.get("categoryId") ?? undefined;

    return ok(await getBarcodeCoverage({ branchId, categoryId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
