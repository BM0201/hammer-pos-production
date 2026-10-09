import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { listProductMerges } from "@/modules/catalog/product-merge-service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

/**
 * GET /api/master/catalog/products/[id]/merges
 *
 * prompt-codigos-y-duplicados.md Fase 3 — historial de productos que se
 * fusionaron HACIA este (el sobreviviente). El fusionado no tiene su
 * propia lista — queda inactivo con mergedIntoProductId apuntando acá.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await context.params;
    const merges = await listProductMerges(id);
    return ok(merges);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
