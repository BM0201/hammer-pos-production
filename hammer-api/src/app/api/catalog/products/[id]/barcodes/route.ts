import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { addBarcode, listProductBarcodes } from "@/modules/catalog/product-barcode-service";
import { addProductBarcodeSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

/**
 * GET/POST /api/catalog/products/[id]/barcodes
 *
 * prompt-codigos-y-duplicados.md Fase 1 — varios códigos por producto
 * (otro proveedor, empaque nuevo, el interno HMR- y el de fábrica).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { id } = await context.params;
    const barcodes = await listProductBarcodes(id);
    return ok(barcodes);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const parsed = addProductBarcodeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const barcode = await addBarcode({ productId: id, rawCode: parsed.data.code, kind: parsed.data.kind, actorUserId: session.userId });
    return ok(barcode);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
