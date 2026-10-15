import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { countBarcodeIssues } from "@/modules/catalog/barcode-search-service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

/**
 * GET /api/catalog/barcodes/issue-counts
 *
 * prompt-codigos-editar-eliminar.md Fase 3.1 — "Con problemas (N)... con
 * chips por problema y su conteo" — el total real, no solo lo de una página.
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    return ok(await countBarcodeIssues());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
