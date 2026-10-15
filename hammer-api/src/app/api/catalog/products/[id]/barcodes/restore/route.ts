import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { restoreBarcode } from "@/modules/catalog/product-barcode-service";
import { restoreProductBarcodeSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

/**
 * POST /api/catalog/products/[id]/barcodes/restore
 *
 * prompt-codigos-editar-eliminar.md Fase 1.2 — "Deshacer" tras quitar un
 * código. Es un addBarcode normal (409 si mientras tanto alguien lo tomó);
 * `makePrimary` fuerza que vuelva a ser el principal.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = restoreProductBarcodeSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const { id } = await context.params;
    const result = await restoreBarcode(id, parsed.data, session.userId);
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
