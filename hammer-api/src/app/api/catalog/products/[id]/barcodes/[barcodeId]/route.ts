import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { removeBarcode, updateBarcode } from "@/modules/catalog/product-barcode-service";
import { updateProductBarcodeSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

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

/**
 * PATCH /api/catalog/products/[id]/barcodes/[barcodeId]
 *
 * prompt-codigos-editar-eliminar.md Fase 1.1 — editar el texto y/o el tipo
 * de un código existente. Dígito verificador inválido viaja en
 * `warnings`, nunca bloquea el guardado.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string; barcodeId: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = updateProductBarcodeSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const { barcodeId } = await context.params;
    const result = await updateBarcode(barcodeId, parsed.data, session.userId);
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
