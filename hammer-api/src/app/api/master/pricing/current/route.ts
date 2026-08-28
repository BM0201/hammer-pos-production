import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { isMaster } from "@/modules/rbac/guards";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { getCurrentPrices, type CurrentPriceSource, type CurrentPricesSort } from "@/modules/pricing/current-prices-service";

const VALID_PRICE_SOURCES: readonly CurrentPriceSource[] = ["BRANCH", "STANDARD", "FUSION_DERIVED", "MISSING"];
const VALID_SORTS: readonly CurrentPricesSort[] = ["name", "marginAsc", "price", "lastUpdate"];

/**
 * Parte B (prompt-precios-vigentes-catalogo.md) — GET /api/master/pricing/current.
 * Mismo guard que la bandeja (isMaster || PRICING_VIEW): es la misma zona
 * Precios. branchId es obligatorio — un precio efectivo sin sucursal no
 * existe, y una tabla que promedia sucursales miente.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session) && !can(session.roleCode, CAPABILITIES.PRICING_VIEW)) {
      return fail("FORBIDDEN", "No tienes permiso para ver los precios vigentes.", 403);
    }

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    if (!branchId) {
      return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);
    }

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
    const pageParam = url.searchParams.get("page");
    const limitParam = url.searchParams.get("limit");
    const page = pageParam ? Math.max(1, Number(pageParam) || 1) : undefined;
    const limit = limitParam ? Math.min(200, Math.max(1, Number(limitParam) || 50)) : undefined;

    const result = await getCurrentPrices({
      branchId,
      categoryId,
      q,
      priceSource: priceSourceParam as CurrentPriceSource | undefined,
      sort: sortParam as CurrentPricesSort | undefined,
      page,
      limit,
    });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
