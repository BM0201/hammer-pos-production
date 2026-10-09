import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getDuplicateCandidates } from "@/modules/catalog/duplicate-finder-service";
import { toHttpErrorResponse } from "@/lib/http";
import { okCached } from "@/lib/api/response";

/**
 * GET /api/master/catalog/products/duplicates
 *
 * prompt-codigos-y-duplicados.md Fase 4 — pares sugeridos, nunca
 * auto-aplicados: la pantalla los muestra, un Master decide fusionar
 * (Fase 3) o descartar (ya no son el mismo producto).
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const pairs = await getDuplicateCandidates();
    // Catálogo completo recorrido en memoria — mismo criterio que el resto
    // de pantallas de catálogo: TTL corto, no tiempo real.
    return okCached(pairs, 60);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
