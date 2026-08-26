import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { getProductBranchPricingStatus } from "@/modules/pricing/branch-price-exception-service";

/**
 * §3.4 (prompt-motor-precios-lote-herencia-gobierno.md) — estado de
 * herencia por sucursal para un producto: si sigue el precio general o
 * tiene una excepción declarada, con su motivo, fecha, costo y margen.
 */
export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_VIEW)) {
      return fail("FORBIDDEN", "No tienes permiso para ver precios.", 403);
    }

    const { productId } = await params;
    return ok(await getProductBranchPricingStatus(productId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
