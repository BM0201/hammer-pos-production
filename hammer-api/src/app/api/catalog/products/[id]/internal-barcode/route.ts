import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { assignInternalBarcode } from "@/modules/catalog/service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

/**
 * POST /api/catalog/products/[id]/internal-barcode
 *
 * prompt-alta-productos-qr.md Fase 1 — asigna un código interno (HMR-<sku>)
 * a un producto que todavía no tiene código de fábrica. Mismo permiso que
 * editar un producto (assertMaster, ver [id]/route.ts PATCH). Si el
 * producto ya tiene un barcode, 409 sin tocarlo.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const product = await assignInternalBarcode(id, session.userId);
    return ok(product);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("BARCODE_ALREADY_SET:")) {
      return fail("BARCODE_ALREADY_SET", error.message.replace(/^BARCODE_ALREADY_SET:\s?/, ""), 409);
    }
    return toHttpErrorResponse(error);
  }
}
