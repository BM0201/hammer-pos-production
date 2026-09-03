import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { formatDualStock } from "@/modules/inventory/unit-conversion";
import { getEffectiveProductPricing, getEffectiveProductPricingBatch, FUSION_PRICE_OVERRIDE_THRESHOLD, relativeDeviation } from "@/modules/catalog/effective-pricing";
import { assertPriceNotBelowCost } from "@/modules/pricing/price-guard";
import { setBranchPriceTx } from "@/modules/pricing/branch-price-exception-service";
import { buildProductSearchWhere, rankProductMatches } from "@/modules/catalog/product-search";
import type { CatalogInventoryQuery, UpdateBranchProductSettingInput, MassDeleteProductsInput } from "./validators";

const CRITICAL_STOCK_FALLBACK = 1;

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

/**
 * Parte A (prompt-precios-vigentes-catalogo.md) — pura, exportada para test.
 * "Sin precio de verdad" es ni el general (standardSalePrice) ni el de
 * ninguna sucursal. Antes era `branchSettings.every((s) => branchPrice <= 0)`:
 * Array.every sobre un arreglo VACÍO da true, así que un producto sin
 * ninguna fila BranchProductSetting — el caso normal de un producto que
 * sigue el precio general en todas las sucursales — quedaba marcado "sin
 * precio", y la condición nunca miraba standardSalePrice, que es justo lo
 * que effective-pricing.ts resuelve como STANDARD cuando no hay branchPrice.
 * Mismo error conceptual que se corrigió en la Fase 3 para las excepciones
 * de precio: "sigue el general" no es "no tiene precio".
 */
export function computeHasNoPrice(standardSalePrice: number, branchPrices: number[]): boolean {
  const hasAnyBranchPrice = branchPrices.some((price) => price > 0);
  return standardSalePrice <= 0 && !hasAnyBranchPrice;
}

/**
 * Costo a MOSTRAR en el catálogo ("precios y costos"), coherente con el motor
 * de venta (modules/catalog/effective-pricing.ts → resolveCostChain).
 *
 * Prioridad: WAC (costo promedio ponderado, si es > 0) > averageCost >
 * globalCost > lastPurchaseCost. Un WAC de 0 significa "no sé", no "vale 0", y
 * se ignora. Para un miembro DERIVADO de fusión, `wac` y los campos de costo
 * son los del CANÓNICO (en unidad base) y `factor` los escala a la unidad del
 * derivado; para el canónico y los productos sin fusión, `factor` = 1 y son sus
 * propios campos.
 *
 * BUG que corrige: antes el catálogo tomaba el costo SOLO de
 * averageCost/globalCost/lastPurchaseCost e IGNORABA el WAC. Al comprar arena
 * por CAMIONADA y AJUSTAR el stock físico (en latas) se actualiza el WAC del
 * canónico (LATA), pero NO esos tres campos (solo las recepciones de orden de
 * compra los actualizan). Resultado: la venta usaba el WAC correcto (WAC ×
 * factor para METRO GRANDE/PEQUEÑA), mientras el catálogo mostraba un costo
 * viejo o en cero, un margen equivocado y marcaba la LATA y sus derivados como
 * "sin costo". Al incluir el WAC aquí, el costo mostrado coincide con el de
 * venta.
 */
export function resolveCatalogDisplayCost(input: {
  wac: number | null;
  averageCost: Prisma.Decimal | number | string | null | undefined;
  globalCost: Prisma.Decimal | number | string | null | undefined;
  lastPurchaseCost: Prisma.Decimal | number | string | null | undefined;
  factor?: number;
}): number {
  const factor = input.factor !== undefined && Number.isFinite(input.factor) ? (input.factor as number) : 1;
  const usableWac = input.wac !== null && Number.isFinite(input.wac) && input.wac > 0 ? input.wac : null;
  const baseCost = usableWac ?? decimalToNumber(input.averageCost ?? input.globalCost ?? input.lastPurchaseCost);
  return baseCost * factor;
}

type CatalogStockConversion = {
  stockGroupId: string;
  stockGroupCode: string;
  stockGroupName: string;
  baseUnit: string;
  packageUnit: string | null;
  saleUnit: string;
  conversionFactor: Prisma.Decimal;
  conversionFactorToBase: Prisma.Decimal | null;
  tracksPackages: boolean;
  approximateFactor: boolean;
  minimumClosedPackageReserve: Prisma.Decimal;
  autoOpenForUnitSale: boolean;
  isPackagePresentation: boolean;
  canonicalProductId: string;
  isCanonical: boolean;
};

function productWhere(params: Partial<CatalogInventoryQuery>): Prisma.ProductWhereInput {
  return {
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(params.q
      ? buildProductSearchWhere<Prisma.ProductWhereInput>(params.q, ["sku", "name", "barcode", "category.name"])
      : {}),
  };
}

export async function getCatalogInventoryCenter(params: Partial<CatalogInventoryQuery> = {}) {
  const where = productWhere(params);
  const page = params.page ?? 1;
  const limit = params.limit ?? 50;
  const hasFilter = !!params.filter;

  /* ── Shared includes for product queries ── */
  const productInclude = {
    category: { select: { id: true, name: true } },
    inventoryBalances: {
      where: params.branchId ? { branchId: params.branchId } : undefined,
      include: { branch: { select: { id: true, code: true, name: true } } },
    },
    branchProductSettings: {
      include: { branch: { select: { id: true, code: true, name: true } } },
    },
    reorderPolicies: {
      where: params.branchId ? { branchId: params.branchId } : undefined,
      include: { branch: { select: { id: true, code: true, name: true } } },
    },
  } as const;

  /* ── Helper to enrich a product row ──
     costo/margen (baseCost, hasNoCost): docs/COSTO-UNA-FUENTE.md — resuelto
     con branchPricingByKey (getEffectiveProductPricingBatch), la MISMA
     fuente que branchEffectivePricing más abajo, en vez de una cascada
     propia sin branchCost. branchPricingByKey y costBranchId se calculan
     más abajo (antes de la primera llamada real a esta función) y se leen
     acá por clausura — fusión-aware, no hace falta resolverlo dos veces
     para los miembros derivados. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function enrichProduct(product: any, policyMap: Map<string, any>) {
    const productBalances: any[] = product.inventoryBalances;
    const totalStock = productBalances.reduce((sum: number, row: any) => sum + decimalToNumber(row.quantityOnHand), 0);
    const totalValue = productBalances.reduce((sum: number, row: any) => sum + decimalToNumber(row.inventoryValue), 0);
    const branchesWithStock = productBalances.filter((row: any) => decimalToNumber(row.quantityOnHand) > 0).length;
    const pricing = costBranchId ? branchPricingByKey.get(`${costBranchId}:${product.id}`) : undefined;
    const productCost = pricing?.effectiveCost != null ? Number(pricing.effectiveCost) : 0;
    const critical = productBalances.some((row: any) => {
      const policy = policyMap.get(`${product.id}:${row.branchId}`);
      const rp = policy ? decimalToNumber(policy.reorderPoint) : CRITICAL_STOCK_FALLBACK;
      return decimalToNumber(row.quantityOnHand) <= rp;
    });
    const branchSettings: any[] = product.branchProductSettings;
    return {
      ...product,
      totalStock,
      branchesWithStock,
      inventoryValue: totalValue,
      baseCost: productCost,
      basePrice: decimalToNumber(product.standardSalePrice),
      isCriticalStock: critical,
      hasZeroStock: totalStock === 0,
      hasNegativeStock: productBalances.some((row: any) => decimalToNumber(row.quantityOnHand) < 0),
      hasNoCost: productCost <= 0,
      hasNoPrice: computeHasNoPrice(
        decimalToNumber(product.standardSalePrice),
        branchSettings.map((setting: any) => decimalToNumber(setting.branchPrice)),
      ),
      // NO implica falta de precio — sigue el general, que es un estado
      // válido y esperado. Es "sin excepción propia en ESTA sucursal", no
      // "sin precio". Distinto de hasNoPrice de arriba a propósito.
      hasNoBranchPrice: params.branchId
        ? !branchSettings.some((setting: any) => setting.branchId === params.branchId && decimalToNumber(setting.branchPrice) > 0)
        : undefined,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function matchesFilter(row: any) {
    if (!params.filter) return true;
    if (params.filter === "LOW_STOCK") return row.isCriticalStock;
    if (params.filter === "ZERO_STOCK") return row.hasZeroStock;
    if (params.filter === "NEGATIVE_STOCK") return row.hasNegativeStock;
    if (params.filter === "NO_COST") return row.hasNoCost;
    if (params.filter === "NO_PRICE") return row.hasNoPrice;
    if (params.filter === "NO_BRANCH_PRICE") return Boolean(row.hasNoBranchPrice);
    return true;
  }

  /* ── Load reference data + balances/movements etc. in parallel ── */
  const [
    branches,
    categories,
    balances,
    movements,
    transfers,
    reorderAlerts,
    reorderPolicies,
    auditLogs,
    totalProductsRaw,
  ] = await Promise.all([
    prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.category.findMany({
      select: { id: true, code: true, name: true, isActive: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.inventoryBalance.findMany({
      where: params.branchId ? { branchId: params.branchId } : undefined,
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true, categoryId: true, standardSalePrice: true, isActive: true } },
      },
      orderBy: [{ product: { name: "asc" } }, { branch: { code: "asc" } }],
    }),
    prisma.inventoryMovement.findMany({
      where: params.branchId ? { branchId: params.branchId } : undefined,
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.transfer.findMany({
      include: {
        fromBranch: { select: { id: true, code: true, name: true } },
        toBranch: { select: { id: true, code: true, name: true } },
        lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.reorderAlert.findMany({
      where: { status: "OPEN", ...(params.branchId ? { branchId: params.branchId } : {}) },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true } },
        sourceBranch: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    prisma.stockReorderPolicy.findMany({
      where: { isActive: true, ...(params.branchId ? { branchId: params.branchId } : {}) },
      select: { branchId: true, productId: true, minQuantity: true, reorderPoint: true },
    }),
    prisma.auditLog.findMany({
      where: {
        module: { in: ["catalog", "inventory", "import", "import-excel", "transfers", "reorder", "catalog-inventory"] },
      },
      include: { actor: { select: { id: true, username: true, fullName: true } }, branch: { select: { id: true, code: true, name: true } } },
      orderBy: { occurredAt: "desc" },
      take: 60,
    }),
    prisma.product.count({ where }),
  ]);

  const policyByProductBranch = new Map(reorderPolicies.map((policy) => [`${policy.productId}:${policy.branchId}`, policy]));
  const allMetricProducts = await prisma.product.findMany({
    where,
    include: productInclude,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  /* ── Costo y precio EFECTIVOS por sucursal — el mismo motor que usa la venta ──
     docs/COSTO-UNA-FUENTE.md — se calcula ACÁ, antes de enrichProduct, para
     TODOS los productos que matchean el filtro (no solo la página actual):
     tanto los KPIs (allMetricRows, sin paginar) como cada fila necesitan el
     mismo costo efectivo, y antes se calculaban con dos cascadas distintas
     (una para el KPI/columna, otra —correcta— para branchEffectivePricing).
     getEffectiveProductPricingBatch (catalog/effective-pricing.ts) ya es
     fusión-aware (branchCost > WAC > averageCost > globalCost >
     lastPurchaseCost, canónico × factor para un derivado) — no se
     reimplementa acá. Sucursal en contexto: params.branchId si viene, si no
     la primera sucursal activa por código — NUNCA un promedio entre
     sucursales (un costo promedio entre sucursales no es el costo de nada). */
  const costBranchId = params.branchId ?? branches[0]?.id ?? null;
  const allMetricProductIds = allMetricProducts.map((product) => product.id);
  const branchPricingItems = allMetricProductIds.flatMap((productId) => branches.map((branch) => ({ branchId: branch.id, productId })));
  const branchPricingByKey = await getEffectiveProductPricingBatch(prisma, branchPricingItems);

  const allMetricRows = allMetricProducts.map((product) => enrichProduct(product, policyByProductBranch));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let filteredProducts: any[];
  let totalFiltered: number;

  if (hasFilter) {
    /* When a computed filter is active, we must load ALL products matching the text/category
       where clause, enrich them, filter, then paginate in-memory. This is unavoidable because
       LOW_STOCK, NO_COST, etc. depend on inventory balances that can't be expressed as a Prisma WHERE. */
    const allMatching = allMetricRows.filter(matchesFilter);
    totalFiltered = allMatching.length;
    filteredProducts = allMatching.slice((page - 1) * limit, page * limit);
  } else {
    /* No computed filter → efficient DB-level offset pagination */
    const products = await prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    });
    totalFiltered = totalProductsRaw;
    filteredProducts = products.map((p) => enrichProduct(p, policyByProductBranch));
  }

  const filteredProductIds = filteredProducts.map((product) => product.id);
  const stockGroupMembers = filteredProductIds.length > 0
    ? await prisma.productStockGroupMember.findMany({
        where: { productId: { in: filteredProductIds }, isActive: true, stockGroup: { isActive: true } },
        include: {
          stockGroup: {
            include: {
              products: {
                where: { isActive: true },
                select: { productId: true, isCanonical: true, conversionFactor: true, isPackagePresentation: true },
                orderBy: [{ isCanonical: "desc" }, { conversionFactor: "asc" }],
              },
            },
          },
        },
      })
    : [];
  const conversionByProductId = new Map<string, CatalogStockConversion>();
  for (const member of stockGroupMembers) {
    const canonical = member.stockGroup.products.find((item) => item.isCanonical)
      ?? member.stockGroup.products.find((item) => new Prisma.Decimal(item.conversionFactor).eq(1))
      ?? member;
    conversionByProductId.set(member.productId, {
      stockGroupId: member.stockGroupId,
      stockGroupCode: member.stockGroup.code,
      stockGroupName: member.stockGroup.name,
      baseUnit: member.stockGroup.baseUnit,
      packageUnit: member.stockGroup.packageUnit,
      saleUnit: member.saleUnit,
      conversionFactor: member.conversionFactor,
      conversionFactorToBase: member.stockGroup.conversionFactorToBase,
      tracksPackages: member.stockGroup.tracksPackages,
      approximateFactor: member.stockGroup.approximateFactor,
      minimumClosedPackageReserve: member.stockGroup.minimumClosedPackageReserve,
      autoOpenForUnitSale: member.stockGroup.autoOpenForUnitSale,
      isPackagePresentation: member.isPackagePresentation,
      canonicalProductId: canonical.productId,
      isCanonical: member.isCanonical,
    });
  }
  const inventoryProductIds = Array.from(new Set(filteredProducts.map((product) => conversionByProductId.get(product.id)?.canonicalProductId ?? product.id)));
  const branchIds = branches.map((branch) => branch.id);
  const sharedInventoryBalances = inventoryProductIds.length > 0 && branchIds.length > 0
    ? await prisma.inventoryBalance.findMany({
        where: { productId: { in: inventoryProductIds }, branchId: { in: branchIds } },
        select: { branchId: true, productId: true, quantityOnHand: true, closedPackageQuantity: true, looseUnitQuantity: true, weightedAverageCost: true },
      })
    : [];
  const sharedBalanceByBranchProduct = new Map(sharedInventoryBalances.map((balance) => [`${balance.branchId}:${balance.productId}`, balance]));

  /* ── branchEffectivePricing (costo/precio efectivo por sucursal, TODAS
     las sucursales activas — la Vista comparativa de Precios y costos
     necesita cada una a la vez) — reusa branchPricingByKey, ya calculado
     arriba (antes de enrichProduct) para docs/COSTO-UNA-FUENTE.md. No se
     vuelve a pedir acá: filteredProducts es siempre un subconjunto de
     allMetricProducts (mismo `where`, solo paginado distinto). */
  filteredProducts = filteredProducts.map((product) => {
    const conversion = conversionByProductId.get(product.id) ?? null;
    const inventoryProductId = conversion?.canonicalProductId ?? product.id;
    const branchEffectivePricing = branches.map((branch) => {
      const pricing = branchPricingByKey.get(`${branch.id}:${product.id}`);
      return {
        branchId: branch.id,
        effectiveCost: pricing?.effectiveCost != null ? Number(pricing.effectiveCost) : null,
        costSource: pricing?.costSource ?? "NONE",
        effectivePrice: pricing?.effectivePrice != null ? Number(pricing.effectivePrice) : null,
        priceSource: pricing?.priceSource ?? "MISSING",
        branchCost: pricing?.branchCost != null ? Number(pricing.branchCost) : null,
        branchPrice: pricing?.branchPrice != null ? Number(pricing.branchPrice) : null,
        isFusionMember: pricing?.isFusionMember ?? false,
        sellability: pricing?.sellability ?? "NO_COST",
      };
    });
    const sharedBalances = branches.map((branch) => {
      const balance = sharedBalanceByBranchProduct.get(`${branch.id}:${inventoryProductId}`);
      return {
        branchId: branch.id,
        inventoryProductId,
        quantityOnHand: balance?.quantityOnHand ?? null,
        closedPackageQuantity: balance?.closedPackageQuantity ?? null,
        looseUnitQuantity: balance?.looseUnitQuantity ?? null,
        weightedAverageCost: balance?.weightedAverageCost ?? null,
      };
    });
    const selectedShared = params.branchId ? sharedBalances.find((balance) => balance.branchId === params.branchId) : null;
    const aggregateBaseQty = sharedBalances.reduce((sum, balance) => sum.add(balance.quantityOnHand ?? 0), new Prisma.Decimal(0));
    const aggregateClosedPackageQty = sharedBalances.reduce((sum, balance) => sum.add(balance.closedPackageQuantity ?? 0), new Prisma.Decimal(0));
    const aggregateLooseUnitQty = sharedBalances.reduce((sum, balance) => sum.add(balance.looseUnitQuantity ?? 0), new Prisma.Decimal(0));
    const aggregateInventoryValue = sharedBalances.reduce((sum, balance) => {
      const qty = balance.quantityOnHand ?? new Prisma.Decimal(0);
      const wac = balance.weightedAverageCost ?? new Prisma.Decimal(0);
      return sum.add(qty.mul(wac));
    }, new Prisma.Decimal(0));
    const displayedBaseQty = selectedShared?.quantityOnHand ?? aggregateBaseQty;
    const displayedClosedPackageQty = selectedShared?.closedPackageQuantity ?? aggregateClosedPackageQty;
    const displayedLooseUnitQty = selectedShared?.looseUnitQuantity ?? aggregateLooseUnitQty;
    const displayedWac = selectedShared?.weightedAverageCost ?? (aggregateBaseQty.gt(0) ? aggregateInventoryValue.div(aggregateBaseQty) : null);
    const sharedStock = conversion && displayedBaseQty
        ? formatDualStock({
            baseQuantity: displayedBaseQty,
            conversionFactor: conversion.conversionFactor,
            packageConversionFactor: conversion.conversionFactorToBase,
            baseUnit: conversion.baseUnit,
            saleUnit: conversion.saleUnit,
            closedPackageQuantity: displayedClosedPackageQty,
            looseUnitQuantity: displayedLooseUnitQty,
            packageUnit: conversion.packageUnit,
            tracksPackages: conversion.tracksPackages,
            minimumClosedPackageReserve: conversion.minimumClosedPackageReserve,
            autoOpenForUnitSale: conversion.autoOpenForUnitSale,
          })
        : null;
    return {
      ...product,
      ...(conversion ? {
        // baseCost/hasNoCost NO se recalculan acá — ya vienen correctos de
        // enrichProduct (branchPricingByKey, fusión-aware) en el spread
        // ...product de abajo. docs/COSTO-UNA-FUENTE.md.
        totalStock: Number(displayedBaseQty),
        branchesWithStock: sharedBalances.filter((balance) => decimalToNumber(balance.quantityOnHand) > 0).length,
        inventoryValue: Number(aggregateInventoryValue),
        weightedAverageCostEstimate: displayedWac ? Number(displayedWac) : null,
        hasZeroStock: displayedBaseQty.eq(0),
        hasNegativeStock: displayedBaseQty.lt(0),
      } : {}),
      stockConversion: conversion ? {
        stockGroupId: conversion.stockGroupId,
        stockGroupCode: conversion.stockGroupCode,
        stockGroupName: conversion.stockGroupName,
        baseUnit: conversion.baseUnit,
        packageUnit: conversion.packageUnit,
        saleUnit: conversion.saleUnit,
        conversionFactor: conversion.conversionFactor,
        conversionFactorToBase: conversion.conversionFactorToBase,
        tracksPackages: conversion.tracksPackages,
        approximateFactor: conversion.approximateFactor,
        minimumClosedPackageReserve: conversion.minimumClosedPackageReserve,
        autoOpenForUnitSale: conversion.autoOpenForUnitSale,
        isPackagePresentation: conversion.isPackagePresentation,
        isCanonical: conversion.isCanonical,
      } : null,
      sharedStock,
      branchEffectivePricing,
      allSharedInventoryBalances: sharedBalances.map((balance) => ({
        branchId: balance.branchId,
        inventoryProductId: balance.inventoryProductId,
        quantityOnHand: balance.quantityOnHand?.toString() ?? null,
        closedPackageQuantity: balance.closedPackageQuantity?.toString() ?? null,
        looseUnitQuantity: balance.looseUnitQuantity?.toString() ?? null,
        weightedAverageCost: balance.weightedAverageCost?.toString() ?? null,
      })),
    };
  });

  /* ── Build balance map for KPIs (uses first page balances list) ── */
  const balanceByProduct = new Map<string, typeof balances>();
  for (const balance of balances) {
    const list = balanceByProduct.get(balance.productId) ?? [];
    list.push(balance);
    balanceByProduct.set(balance.productId, list);
  }

  /* ── KPIs: computed from the current page when no filter, or from all matching when filtered ── */
  const activeBalances = balances.filter((row) => row.product.isActive);
  const totalInventoryValue = activeBalances.reduce((sum, row) => sum + decimalToNumber(row.inventoryValue), 0);

  const kpis = {
    activeProducts: allMetricRows.filter((row) => row.isActive).length,
    skusWithoutInventory: allMetricRows.filter((row) => row.isActive && row.inventoryBalances.length === 0).length,
    criticalStockProducts: allMetricRows.filter((row) => row.isActive && row.isCriticalStock).length,
    zeroStockProducts: allMetricRows.filter((row) => row.isActive && row.hasZeroStock).length,
    totalInventoryValue,
    // Nota: las métricas financieras (ingreso potencial, margen bruto) viven ahora
    // exclusivamente en Finanzas & Contabilidad (modules/finance/service.ts →
    // getFinanceSummary). Se eliminaron de aquí por no tener consumidores.
    productsWithoutCost: allMetricRows.filter((row) => row.isActive && row.hasNoCost).length,
    productsWithoutPrice: allMetricRows.filter((row) => row.isActive && row.hasNoPrice).length,
    missingPriceCount: params.branchId
      ? allMetricRows.filter((row) => row.isActive && row.hasNoBranchPrice).length
      : allMetricRows.filter((row) => row.isActive && row.hasNoPrice).length,
  };

  const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));

  // Mismo criterio de relevancia que POS/catálogo — no se rediseña la tabla,
  // solo se ordena mejor dentro de la página actual.
  const rankedProducts = params.q ? rankProductMatches(filteredProducts, params.q) : filteredProducts;

  return {
    branches,
    categories,
    kpis,
    products: rankedProducts,
    balances,
    movements,
    pagination: {
      page,
      limit,
      total: totalFiltered,
      totalPages,
    },
    transfers,
    reorderAlerts,
    auditLogs,
  };
}

export async function getCatalogInventoryProduct(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: { select: { id: true, name: true } },
      inventoryBalances: { include: { branch: { select: { id: true, code: true, name: true } } }, orderBy: { branch: { code: "asc" } } },
      inventoryMovements: {
        include: { branch: { select: { id: true, code: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 80,
      },
      branchProductSettings: { include: { branch: { select: { id: true, code: true, name: true } } } },
      reorderPolicies: { include: { branch: { select: { id: true, code: true, name: true } } } },
      brainDecisions: {
        orderBy: { createdAt: "desc" },
        take: 25,
        include: { branch: { select: { id: true, code: true, name: true } } },
      },
    },
  });
  if (!product) throw new Error("NOT_FOUND");

  const auditLogs = await prisma.auditLog.findMany({
    where: { entityId: productId },
    include: { actor: { select: { id: true, username: true, fullName: true } }, branch: { select: { id: true, code: true, name: true } } },
    orderBy: { occurredAt: "desc" },
    take: 60,
  });

  return { product, auditLogs };
}

/**
 * El cuerpo transaccional de upsertBranchProductSetting, separado del
 * wrapper para poder probarlo con un tx en memoria (mismo patrón que
 * applySuggestedPriceTx/setBranchPriceTx) — el wrapper hace los guards que
 * SÍ necesitan el cliente global de Prisma (existencia de branch/product,
 * assertPriceNotBelowCost, desvío de fusión) antes de abrir la transacción.
 *
 * Parte B (prompt-huecos-fase1-fase3-despliegue.md) — branchPrice pasa
 * SIEMPRE por setBranchPriceTx: es el único escritor. branchPrice != null
 * exige motivo (>= 3 caracteres) — el modal de catálogo lo pide cuando el
 * usuario escribe un precio de sucursal distinto del actual; sin eso, este
 * camino creaba exactamente la divergencia silenciosa (branchPrice con
 * priceExceptionReason en null) que la Fase 3 existe para eliminar.
 * minPrice/wholesalePrice SIN branchPrice siguen disparando el bookkeeping
 * de "se tocó un precio" (priceSource/lastPriceUpdateAt/priceUpdatedByUserId)
 * como antes — eso no es competencia de setBranchPriceTx, que solo
 * administra branchPrice y su excepción.
 */
export async function upsertBranchProductSettingTx(tx: Prisma.TransactionClient, input: UpdateBranchProductSettingInput, actorUserId: string) {
  const touchesPriceBookkeeping = input.branchPrice !== undefined || input.minPrice !== undefined || input.wholesalePrice !== undefined;
  const otherFieldsData = {
    isAvailable: input.isAvailable,
    minStock: input.minStock === undefined ? undefined : input.minStock === null ? null : new Prisma.Decimal(input.minStock),
    maxStock: input.maxStock === undefined ? undefined : input.maxStock === null ? null : new Prisma.Decimal(input.maxStock),
    reorderPoint: input.reorderPoint === undefined ? undefined : input.reorderPoint === null ? null : new Prisma.Decimal(input.reorderPoint),
    minPrice: input.minPrice === undefined ? undefined : input.minPrice === null ? null : new Prisma.Decimal(input.minPrice),
    wholesalePrice: input.wholesalePrice === undefined ? undefined : input.wholesalePrice === null ? null : new Prisma.Decimal(input.wholesalePrice),
    marginPercent: input.marginPercent === undefined ? undefined : input.marginPercent === null ? null : new Prisma.Decimal(input.marginPercent),
  };

  if (input.branchPrice !== undefined) {
    await setBranchPriceTx(tx, {
      branchId: input.branchId,
      productId: input.productId,
      branchPrice: input.branchPrice === null ? null : new Prisma.Decimal(input.branchPrice),
      exceptionReason: input.priceExceptionReason ?? null,
      priceSource: "MANUAL",
      actorUserId,
      origin: "catalogo",
    });
    return tx.branchProductSetting.update({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      data: otherFieldsData,
    });
  }

  // branchPrice no se toca — sin cambios respecto al comportamiento
  // previo: minPrice/wholesalePrice solos también bumpean el bookkeeping.
  const data = {
    ...otherFieldsData,
    priceSource: touchesPriceBookkeeping ? "MANUAL" : undefined,
    lastPriceUpdateAt: touchesPriceBookkeeping ? new Date() : undefined,
    priceUpdatedByUserId: touchesPriceBookkeeping ? actorUserId : undefined,
  };
  return tx.branchProductSetting.upsert({
    where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    create: { branchId: input.branchId, productId: input.productId, ...data },
    update: data,
  });
}

export async function upsertBranchProductSetting(input: UpdateBranchProductSettingInput, actorUserId: string) {
  const [branch, product] = await Promise.all([
    prisma.branch.findUnique({ where: { id: input.branchId }, select: { id: true } }),
    prisma.product.findUnique({ where: { id: input.productId }, select: { id: true } }),
  ]);
  if (!branch) throw new Error("INVALID_INPUT: branchId no existe.");
  if (!product) throw new Error("INVALID_INPUT: productId no existe.");

  // Auditoría 2026-07-22 (ALTO Catálogo): bloqueo de precio bajo costo,
  // ausente hasta ahora en la edición inline de precio por sucursal.
  if (input.branchPrice !== undefined && input.branchPrice !== null) {
    const pricing = await getEffectiveProductPricing(prisma, { branchId: input.branchId, productId: input.productId });
    assertPriceNotBelowCost({
      price: input.branchPrice,
      cost: pricing.effectiveCost === null ? null : Number(pricing.effectiveCost),
    });

    // prompt-costos-precios-fusion.md §2.2: el override sigue permitido (hay
    // razones legítimas — vender por metro más barato que por lata suelta),
    // pero deja de ser invisible. Un desvío grande respecto al precio
    // implícito de fusión exige confirmación explícita en vez de guardarse
    // como "un precio suelto más".
    if (pricing.isFusionMember && pricing.impliedFusionPrice !== null) {
      const deviation = relativeDeviation(new Prisma.Decimal(input.branchPrice), pricing.impliedFusionPrice);
      if (deviation !== null && deviation > FUSION_PRICE_OVERRIDE_THRESHOLD && !input.overridePriceConfirmed) {
        const pct = Math.round(deviation * 100);
        throw new Error(
          `FUSION_PRICE_OVERRIDE_CONFIRMATION_REQUIRED: El precio implícito de esta presentación (canónico × factor) es ${pricing.impliedFusionPrice.toFixed(2)}; estás guardando ${input.branchPrice.toFixed(2)}, un ${pct}% de desvío. Confirma si es intencional.`,
        );
      }
    }
  }

  const setting = await prisma.$transaction((tx) => upsertBranchProductSettingTx(tx, input, actorUserId));

  await logAuditEvent({
    actorUserId,
    branchId: input.branchId,
    module: "catalog-inventory",
    action: input.branchPrice !== undefined || input.minPrice !== undefined || input.wholesalePrice !== undefined
      ? "BRANCH_PRICE_UPDATED"
      : "BRANCH_PRODUCT_SETTING_UPSERT",
    entityType: "BranchProductSetting",
    entityId: setting.id,
    metadataJson: {
      productId: input.productId,
      branchPrice: input.branchPrice ?? null,
      minPrice: input.minPrice ?? null,
      wholesalePrice: input.wholesalePrice ?? null,
      marginPercent: input.marginPercent ?? null,
      priceExceptionReason: input.branchPrice ? (input.priceExceptionReason ?? null) : null,
    },
  });

  return setting;
}

export async function massDeleteAllProducts(input: MassDeleteProductsInput, actorUserId: string) {
  const totalProducts = await prisma.product.count();

  /* ── Safety: esta herramienta borra en cascada el historial de ventas e
   * inventario completo (ver más abajo) — es para resetear datos de prueba
   * ANTES de operar con clientes reales, nunca después. Una vez que existe
   * al menos un pago POSTED (una venta real cobrada), queda bloqueada de
   * forma permanente e incondicional: ninguna frase de confirmación puede
   * saltarse esto. */
  const postedPaymentsCount = await prisma.payment.count({ where: { status: "POSTED" } });
  if (postedPaymentsCount > 0) {
    throw new Error(
      "INVALID_INPUT: No se puede borrar — el sistema ya tiene pagos reales registrados (histórico de ventas). Esta herramienta solo está disponible antes de operar con datos reales.",
    );
  }

  /* ── Safety: verify the confirmation phrase matches ── */
  const expectedPhrase = `Borrar los ${totalProducts} productos`;
  if (input.confirmation !== expectedPhrase) {
    throw new Error("INVALID_INPUT: La frase de confirmación no coincide.");
  }
  if (input.expectedCount !== totalProducts) {
    throw new Error("INVALID_INPUT: La cantidad esperada no coincide con el total actual de productos.");
  }

  /* ── Delete all related records then products in a transaction ── */
  const result = await prisma.$transaction(async (tx) => {
    await tx.brainDecision.deleteMany({});
    await tx.productAnalytics.deleteMany({});
    await tx.productPricing.deleteMany({});
    await tx.reorderSuggestionLine.deleteMany({});
    await tx.reorderAlert.deleteMany({});
    await tx.stockReorderPolicy.deleteMany({});
    await tx.branchProductSetting.deleteMany({});
    await tx.inventoryMovement.deleteMany({});
    await tx.inventoryBalance.deleteMany({});
    await tx.transferLine.deleteMany({});
    await tx.transfer.deleteMany({});
    await tx.saleOrderLine.deleteMany({});
    await tx.saleOrder.deleteMany({});
    const deleted = await tx.product.deleteMany({});
    return deleted.count;
  });

  await logAuditEvent({
    actorUserId,
    module: "catalog-inventory",
    action: "MASS_DELETE_ALL_PRODUCTS",
    entityType: "Product",
    entityId: "ALL",
    metadataJson: { deletedCount: result, confirmation: input.confirmation },
  });

  return { deleted: result };
}
