import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { isMaster } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { getBranchPricingContextForProduct } from "@/modules/pricing/branch-band-service";

/**
 * §4.3 (prompt-motor-precios-lote-herencia-gobierno.md) — precio actual,
 * costo efectivo y banda de la categoría, para mostrar el margen EN VIVO
 * mientras la sucursal escribe un precio nuevo.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    const productId = url.searchParams.get("productId");
    if (!branchId || !productId) return fail("VALIDATION_ERROR", "branchId y productId son requeridos.", 400);

    if (!isMaster(session) && !canInBranch(session, branchId, CAPABILITIES.PRICING_EDIT_BRANCH)) {
      return fail("FORBIDDEN", "No tienes permiso para ver precios en esta sucursal.", 403);
    }

    return ok(await getBranchPricingContextForProduct({ branchId, productId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
