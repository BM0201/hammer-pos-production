import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { findProductByCode } from "@/modules/catalog/service";
import { toHttpErrorResponse } from "@/lib/http";
import { fail, ok } from "@/lib/api/response";

/**
 * GET /api/catalog/products/by-code?code=...
 *
 * prompt-alta-productos-qr.md Fase 1 — coincidencia EXACTA (barcode primero,
 * sku después) para el alta rápida con escáner/lector. Mismos permisos que
 * la búsqueda del catálogo (GET /api/catalog/products): solo requiere sesión.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code") ?? "";
    if (!code.trim()) {
      return fail("VALIDATION_ERROR", "code es obligatorio.", 400);
    }

    return ok(await findProductByCode(code));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
