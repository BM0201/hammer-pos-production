import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { regenerateInternalBarcode } from "@/modules/catalog/product-barcode-service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";

/**
 * POST /api/catalog/products/[id]/barcodes/[barcodeId]/regenerate-internal
 *
 * prompt-codigos-editar-eliminar.md Fase 1.1 — "Regenerar código interno":
 * vuelve a armar el HMR- con el SKU actual. Avisa que hay que reimprimir
 * (`needsReprint`, siempre true en la respuesta).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; barcodeId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { barcodeId } = await context.params;
    const result = await regenerateInternalBarcode(barcodeId, session.userId);
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
