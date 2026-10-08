import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { removeBarcode } from "@/modules/catalog/product-barcode-service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";

/**
 * DELETE /api/catalog/products/[id]/barcodes/[barcodeId]
 *
 * prompt-codigos-y-duplicados.md Fase 1 — quita un código. Si era el
 * principal, el siguiente más viejo lo reemplaza automáticamente.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string; barcodeId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { barcodeId } = await context.params;
    const result = await removeBarcode(barcodeId, session.userId);
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
