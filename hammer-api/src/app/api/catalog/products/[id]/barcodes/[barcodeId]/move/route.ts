import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { moveBarcode } from "@/modules/catalog/product-barcode-service";
import { moveProductBarcodeSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

/**
 * POST /api/catalog/products/[id]/barcodes/[barcodeId]/move
 *
 * prompt-codigos-y-duplicados.md Fase 1 — "este código estaba en el
 * producto equivocado". Bloquea la fila y mueve solo si todavía sigue en
 * el producto origen — un reintento sobre el mismo destino da
 * ALREADY_PROCESSED (409), no repite la reasignación de principal.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; barcodeId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { barcodeId } = await context.params;
    const parsed = moveProductBarcodeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const result = await moveBarcode(barcodeId, parsed.data.toProductId, session.userId);
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
