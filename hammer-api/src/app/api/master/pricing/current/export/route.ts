import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { buildPriceExportWorkbook } from "@/modules/pricing/price-export-service";
import type { CurrentPriceSource, CurrentPricesSort } from "@/modules/pricing/current-prices-service";

const VALID_PRICE_SOURCES: readonly CurrentPriceSource[] = ["BRANCH", "STANDARD", "FUSION_DERIVED", "MISSING"];
const VALID_SORTS: readonly CurrentPricesSort[] = ["name", "marginAsc", "price", "lastUpdate"];

/**
 * prompt-carga-precios.md Fase 4 — "Descargar lista para actualizar". El
 * archivo se devuelve en base64 dentro del JSON de siempre (ok/fail), no
 * como un binario crudo — esta API no tenía ningún endpoint de descarga
 * binaria hasta ahora, y el resto de la app ya mueve binarios (etiquetas
 * QR, fotos) como base64; el navegador arma el Blob del lado del cliente.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_VIEW)) {
      return fail("FORBIDDEN", "No tienes permiso para descargar los precios vigentes.", 403);
    }

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);

    const categoryId = url.searchParams.get("categoryId") ?? undefined;
    const q = url.searchParams.get("q") ?? undefined;
    const priceSourceParam = url.searchParams.get("priceSource") ?? undefined;
    if (priceSourceParam && !VALID_PRICE_SOURCES.includes(priceSourceParam as CurrentPriceSource)) {
      return fail("VALIDATION_ERROR", "priceSource invalido.", 400);
    }
    const sortParam = url.searchParams.get("sort") ?? undefined;
    if (sortParam && !VALID_SORTS.includes(sortParam as CurrentPricesSort)) {
      return fail("VALIDATION_ERROR", "sort invalido.", 400);
    }

    const { buffer, rowCount } = await buildPriceExportWorkbook({
      branchId,
      categoryId,
      q,
      priceSource: priceSourceParam as CurrentPriceSource | undefined,
      sort: sortParam as CurrentPricesSort | undefined,
    });

    return ok({
      filename: `precios-${branchId}.xlsx`,
      base64: Buffer.from(buffer).toString("base64"),
      rowCount,
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
