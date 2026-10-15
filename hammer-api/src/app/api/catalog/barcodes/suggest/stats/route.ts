import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getSuggestionAcceptanceStats } from "@/modules/catalog/barcode-suggestions-service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";

/**
 * GET /api/catalog/barcodes/suggest/stats
 *
 * prompt-codigos-editar-eliminar.md Fase 2.4 — % de veces que se eligió la
 * 1.ª sugerencia, la top 3 o ninguna, en 30 días. Sirve para ajustar los
 * pesos de rankBarcodeSuggestions con datos reales.
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    return ok(await getSuggestionAcceptanceStats());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
