import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";
import { resolveCatalogDisplayCostBatch } from "@/modules/catalog-inventory/service";
import { resolvePolicyForProductBatch } from "@/modules/pricing/category-policy-service";
import { getProductStockConversionsBatch } from "@/modules/inventory/unit-conversion";
import { buildProductSearchWhere, rankProductMatches } from "@/modules/catalog/product-search";
import type { Prisma } from "@prisma/client";

/**
 * Parte B (prompt-precios-vigentes-catalogo.md) — la vista de precios
 * vigentes por sucursal. USA effective-pricing.ts (precio — el mismo que
 * cobra el POS) y resolveCatalogDisplayCost (costo — el mismo que muestra
 * el catálogo) vía sus versiones batch; NO escribe una tercera resolución
 * de ninguno de los dos. branchId es obligatorio a propósito: un precio
 * efectivo sin sucursal no existe, y una tabla que promedia sucursales
 * miente.
 */

export type CurrentPriceSource = "BRANCH" | "STANDARD" | "FUSION_DERIVED" | "MISSING";

export type CurrentPriceRow = {
  productId: string;
  sku: string;
  name: string;
  categoryName: string;
  effectiveCost: number;
  effectivePrice: number | null;
  priceSource: CurrentPriceSource;
  standardPrice: number;
  marginPercent: number | null;
  minMarginPercent: number;
  belowPolicy: boolean;
  priceExceptionReason: string | null;
  priceExceptionAt: string | null;
  lastPriceUpdateAt: string | null;
  stockOnHand: number;
  /** Solo con priceSource FUSION_DERIVED — "SKU · nombre" del canónico, para el tooltip de C.2. */
  canonicalProductLabel: string | null;
};

export type CurrentPricesTotals = {
  total: number;
  byPriceSource: Record<CurrentPriceSource, number>;
  belowPolicyCount: number;
  missingCostCount: number;
};

export type CurrentPricesResult = {
  rows: CurrentPriceRow[];
  totals: CurrentPricesTotals;
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export type CurrentPricesSort = "name" | "marginAsc" | "price" | "lastUpdate";

const EMPTY_TOTALS: CurrentPricesTotals = {
  total: 0,
  byPriceSource: { BRANCH: 0, STANDARD: 0, FUSION_DERIVED: 0, MISSING: 0 },
  belowPolicyCount: 0,
  missingCostCount: 0,
};

/**
 * `db` es inyectable (mismo patrón que getPricingTray en tray-service.ts)
 * para poder probarlo con un fake en memoria. resolveCatalogDisplayCostBatch
 * y resolvePolicyForProductBatch también lo reciben — sin eso, esta función
 * no sería testeable sin base de datos real.
 */
export async function getCurrentPrices(
  filters: {
    branchId: string;
    categoryId?: string;
    q?: string;
    priceSource?: CurrentPriceSource;
    page?: number;
    limit?: number;
    sort?: CurrentPricesSort;
  },
  db: typeof prisma = prisma,
): Promise<CurrentPricesResult> {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 50;

  const where: Prisma.ProductWhereInput = {
    isActive: true,
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.q ? buildProductSearchWhere<Prisma.ProductWhereInput>(filters.q, ["sku", "name", "barcode", "category.name"]) : {}),
  };

  const products = await db.product.findMany({
    where,
    select: { id: true, sku: true, name: true, standardSalePrice: true, categoryId: true },
  });

  if (products.length === 0) {
    return { rows: [], totals: EMPTY_TOTALS, pagination: { page, limit, total: 0, totalPages: 1 } };
  }

  const productIds = products.map((p) => p.id);
  const pairs = productIds.map((productId) => ({ branchId: filters.branchId, productId }));

  const [pricingByKey, costByProductId, policyByKey, conversionByProductId, settings, balances] = await Promise.all([
    getEffectiveProductPricingBatch(db, pairs),
    resolveCatalogDisplayCostBatch(productIds, filters.branchId, db),
    resolvePolicyForProductBatch(pairs, db),
    // C.2 — "Derivado, con el producto canónico en tooltip": mismo lookup
    // fusión-aware ya probado (usado también por getEffectiveProductPricingBatch
    // internamente), no una cuarta resolución.
    getProductStockConversionsBatch(db, productIds),
    db.branchProductSetting.findMany({
      where: { branchId: filters.branchId, productId: { in: productIds } },
      select: { productId: true, priceExceptionReason: true, priceExceptionAt: true, lastPriceUpdateAt: true },
    }),
    // Nota: stockOnHand es el balance PROPIO de esta fila de producto (no el
    // del canónico de fusión, a diferencia del costo) — simplificación
    // deliberada: un miembro derivado sin balance propio muestra 0 acá,
    // aunque tenga stock convertible vía el canónico. El costo SÍ usa la
    // resolución fusión-aware completa (resolveCatalogDisplayCostBatch)
    // porque ahí está la garantía de que coincida con el catálogo/POS;
    // stockOnHand es informativo, no una tercera resolución de inventario.
    db.inventoryBalance.findMany({
      where: { branchId: filters.branchId, productId: { in: productIds } },
      select: { productId: true, quantityOnHand: true },
    }),
  ]);

  const settingByProductId = new Map(settings.map((s) => [s.productId, s]));
  const stockByProductId = new Map(balances.map((b) => [b.productId, Number(b.quantityOnHand)]));

  const canonicalIds = [...new Set(
    productIds
      .map((id) => conversionByProductId.get(id))
      .filter((conversion) => conversion && !conversion.isCanonical)
      .map((conversion) => conversion!.canonicalProductId),
  )];
  const canonicalProducts = canonicalIds.length > 0
    ? await db.product.findMany({ where: { id: { in: canonicalIds } }, select: { id: true, sku: true, name: true } })
    : [];
  const canonicalLabelById = new Map(canonicalProducts.map((p) => [p.id, `${p.sku} · ${p.name}`]));

  const rows: CurrentPriceRow[] = products.map((product) => {
    const key = `${filters.branchId}:${product.id}`;
    const pricing = pricingByKey.get(key);
    const cost = costByProductId.get(product.id) ?? 0;
    const rawPriceNum = pricing?.effectivePrice !== null && pricing?.effectivePrice !== undefined ? Number(pricing.effectivePrice) : 0;
    // effective-pricing.ts ya no produce "MISSING" (standardSalePrice es
    // NOT NULL) — pero standardSalePrice SÍ puede ser 0 (nadie le puso
    // precio nunca), y ahí effectivePrice también sale 0. Mismo criterio
    // que computeHasNoPrice (Parte A): <= 0 es "sin precio de verdad",
    // sin importar qué priceSource "crudo" haya devuelto effective-pricing.ts.
    const priceSource: CurrentPriceSource = rawPriceNum <= 0 ? "MISSING" : pricing!.priceSource;
    const effectivePrice = priceSource === "MISSING" ? null : rawPriceNum;
    const marginPercent = cost > 0 && effectivePrice !== null && effectivePrice > 0
      ? ((effectivePrice - cost) / effectivePrice) * 100
      : null;
    const policy = policyByKey.get(key);
    const minMarginPercent = policy?.categoryPolicy.minMarginPercent ?? 0;
    const belowPolicy = marginPercent !== null && marginPercent < minMarginPercent;
    const setting = settingByProductId.get(product.id);
    const conversion = conversionByProductId.get(product.id);
    const canonicalProductLabel = priceSource === "FUSION_DERIVED" && conversion && !conversion.isCanonical
      ? canonicalLabelById.get(conversion.canonicalProductId) ?? null
      : null;

    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      categoryName: policy?.categoryName ?? "",
      effectiveCost: cost,
      effectivePrice,
      priceSource,
      standardPrice: Number(product.standardSalePrice),
      marginPercent,
      minMarginPercent,
      belowPolicy,
      priceExceptionReason: setting?.priceExceptionReason ?? null,
      priceExceptionAt: setting?.priceExceptionAt ? setting.priceExceptionAt.toISOString() : null,
      lastPriceUpdateAt: setting?.lastPriceUpdateAt ? setting.lastPriceUpdateAt.toISOString() : null,
      stockOnHand: stockByProductId.get(product.id) ?? 0,
      canonicalProductLabel,
    };
  });

  // Totales de LA CONSULTA (branchId + categoryId + q) — sin el filtro de
  // priceSource, que es de presentación, no de alcance (mismo criterio que
  // unfilteredTotals en tray-service.ts: sirve para los chips que muestran
  // las cuatro categorías a la vez, sin importar cuál está seleccionada).
  const totals: CurrentPricesTotals = {
    total: rows.length,
    byPriceSource: {
      BRANCH: rows.filter((r) => r.priceSource === "BRANCH").length,
      STANDARD: rows.filter((r) => r.priceSource === "STANDARD").length,
      FUSION_DERIVED: rows.filter((r) => r.priceSource === "FUSION_DERIVED").length,
      MISSING: rows.filter((r) => r.priceSource === "MISSING").length,
    },
    belowPolicyCount: rows.filter((r) => r.belowPolicy).length,
    missingCostCount: rows.filter((r) => r.effectiveCost <= 0).length,
  };

  const filteredRows = filters.priceSource ? rows.filter((r) => r.priceSource === filters.priceSource) : rows;

  let sortedRows: CurrentPriceRow[];
  if (filters.sort === "marginAsc") {
    sortedRows = [...filteredRows].sort((a, b) => {
      // Sin margen calculable (costo o precio faltante) va al final — no es
      // "el peor", es "no se sabe todavía".
      if (a.marginPercent === null && b.marginPercent === null) return 0;
      if (a.marginPercent === null) return 1;
      if (b.marginPercent === null) return -1;
      return a.marginPercent - b.marginPercent;
    });
  } else if (filters.sort === "price") {
    sortedRows = [...filteredRows].sort((a, b) => (a.effectivePrice ?? -1) - (b.effectivePrice ?? -1));
  } else if (filters.sort === "lastUpdate") {
    sortedRows = [...filteredRows].sort((a, b) => {
      const at = a.lastPriceUpdateAt ? Date.parse(a.lastPriceUpdateAt) : 0;
      const bt = b.lastPriceUpdateAt ? Date.parse(b.lastPriceUpdateAt) : 0;
      return bt - at; // más reciente primero
    });
  } else {
    // "name" (default) — prioriza relevancia de búsqueda cuando hay q,
    // mismo criterio que el catálogo/POS (no se reinventa el ranking).
    sortedRows = filters.q ? rankProductMatches(filteredRows, filters.q) : [...filteredRows].sort((a, b) => a.name.localeCompare(b.name));
  }

  const total = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pageRows = sortedRows.slice((page - 1) * limit, page * limit);

  return { rows: pageRows, totals, pagination: { page, limit, total, totalPages } };
}
