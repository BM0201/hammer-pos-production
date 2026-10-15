import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { suggestProductsForBarcode } from "@/modules/catalog/barcode-suggestions-service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";

/**
 * GET /api/catalog/barcodes/suggest?code&q&branchId&recent=<ids separados por coma>
 *
 * prompt-codigos-editar-eliminar.md Fase 2.1 — "¿podría ser este
 * producto?" al escanear un código que no existe.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const code = url.searchParams.get("code")?.trim();
    if (!code) return fail("VALIDATION_ERROR", "code es obligatorio.", 400);

    const branchId = url.searchParams.get("branchId") ?? undefined;
    if (branchId && !hasBranchAccess(session, branchId)) return fail("FORBIDDEN", "No tenés acceso a esa sucursal.", 403);

    const query = url.searchParams.get("q")?.trim() || undefined;
    const recentProductIds = url.searchParams.get("recent")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

    return ok(await suggestProductsForBarcode({ code, query, branchId, recentProductIds }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
