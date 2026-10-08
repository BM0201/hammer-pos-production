import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { setPrimaryBarcode } from "@/modules/catalog/product-barcode-service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";

/**
 * POST /api/catalog/products/[id]/barcodes/[barcodeId]/primary
 *
 * prompt-codigos-y-duplicados.md Fase 1 — marca un código existente como
 * el principal del producto (el que se refleja en Product.barcode, usa el
 * POS y las etiquetas).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; barcodeId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id, barcodeId } = await context.params;
    const barcode = await setPrimaryBarcode(id, barcodeId, session.userId);
    return ok(barcode);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
