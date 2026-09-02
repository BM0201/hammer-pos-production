import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { generateSkuForProduct, normalizeManualSku } from "@/modules/catalog/sku-generator";
import { resolveEffectivePricingFromParts } from "@/modules/catalog/effective-pricing";
import { formatDualStock, convertBaseQtyToSaleQty, convertBaseUnitCostToSaleUnitCost, getProductStockConversion } from "@/modules/inventory/unit-conversion";
import type { ProductStockConversion } from "@/modules/inventory/unit-conversion";
import { detectPackageCostAsUnitCost, maxPackageFactorForSanityCheck } from "@/modules/inventory/wac";
import { assertPriceNotBelowCost } from "@/modules/pricing/price-guard";
import { buildProductSearchWhere, rankProductMatches, groupProductsByFamily, type FamilyGroup } from "@/modules/catalog/product-search";
import { resolveCatalogDisplayCost } from "@/modules/catalog-inventory/service";
import { aggregateWeightedAverageCost } from "@/modules/catalog/stock-group-crud";

/**
 * "el precio de venta no se mueva solo" — umbral de desvío contra el precio
 * IMPLÍCITO de fusión (canónico × factor) para la edición de standardSalePrice
 * (Parte A.2). Deliberadamente MÁS estrecho que FUSION_PRICE_OVERRIDE_THRESHOLD
 * (20%, effective-pricing.ts — branchPrice por sucursal, un ajuste puntual):
 * standardSalePrice es el precio GENERAL de la presentación, la decisión de
 * fondo, no una excepción local — un desvío de esa magnitud merece confirmarse
 * con un umbral más bajo. Mismo patrón y mecanismo (throw con mensaje que
 * incluye la cifra, flag de confirmación) que ya usa branchPrice — no un
 * mecanismo nuevo.
 */
export const PRODUCT_PRICE_DEVIATION_THRESHOLD = 0.15;

/**
 * Pura, sin DB — aislada para poder probar el cálculo de desvío y el
 * mensaje (incluida la Parte A.3, la pérdida por unidad) sin base de
 * datos, mismo principio que detectExcessiveWacJump (inventory/wac.ts).
 * Decide SI hay que avisar y CON QUÉ mensaje — updateProduct sigue siendo
 * quien resuelve los datos (canónico, WAC) y decide throw vs continuar.
 */
export function evaluatePriceDeviationFromFusion(input: {
  enteredPrice: number;
  canonicalStandardSalePrice: number;
  conversionFactor: number;
  /** Costo efectivo de ESTA presentación (network-wide, WAC-aware, ya factor-escalado) — null si no se puede calcular. */
  effectiveCost: number | null;
  confirmed?: boolean;
}): { deviates: boolean; impliedPrice: number; deviationPercent: number | null; message: string | null } {
  const impliedPrice = input.canonicalStandardSalePrice * input.conversionFactor;
  const deviation = impliedPrice > 0 ? Math.abs(input.enteredPrice - impliedPrice) / impliedPrice : null;
  const deviates = deviation !== null && deviation > PRODUCT_PRICE_DEVIATION_THRESHOLD && !input.confirmed;

  if (!deviates) {
    return { deviates: false, impliedPrice, deviationPercent: deviation !== null ? deviation * 100 : null, message: null };
  }

  const pct = Math.round(deviation! * 100);
  let message = `PRICE_DEVIATES_FROM_FUSION: El precio implícito de esta presentación (canónico × factor) es ${impliedPrice.toFixed(2)}; ` +
    `estás guardando ${input.enteredPrice.toFixed(2)}, un ${pct}% de desvío. Confirma si es intencional.`;

  // A.3 — si además el precio tecleado queda bajo el costo efectivo, el
  // mensaje lo dice con el monto por unidad, no solo el porcentaje.
  if (input.effectiveCost !== null && input.enteredPrice < input.effectiveCost) {
    const loss = input.effectiveCost - input.enteredPrice;
    message += ` A C$${input.enteredPrice.toFixed(2)} perdés C$${loss.toFixed(2)} en cada unidad (costo C$${input.effectiveCost.toFixed(2)}).`;
  }

  return { deviates: true, impliedPrice, deviationPercent: deviation! * 100, message };
}

type CatalogProductWithBranchPricing = {
  id: string;
  unit: string;
  standardSalePrice: Prisma.Decimal;
  globalCost?: Prisma.Decimal | null;
  averageCost?: Prisma.Decimal | null;
  lastPurchaseCost?: Prisma.Decimal | null;
  branchProductSettings?: Array<{ branchId: string; branchPrice: Prisma.Decimal | null; branchCost: Prisma.Decimal | null }>;
  inventoryBalances?: Array<{
    branchId: string;
    quantityOnHand?: Prisma.Decimal;
    closedPackageQuantity?: Prisma.Decimal;
    looseUnitQuantity?: Prisma.Decimal;
    weightedAverageCost: Prisma.Decimal;
  }>;
  category?: { id: string; code?: string; name: string } | null;
};

type StockGroupMemberRow = {
  productId: string;
  saleUnit: string;
  conversionFactor: Prisma.Decimal;
  isCanonical: boolean;
  isPackagePresentation: boolean;
  stockGroup: {
    id: string;
    code: string;
    name: string;
    baseUnit: string;
    packageUnit: string | null;
    conversionFactorToBase: Prisma.Decimal | null;
    tracksPackages: boolean;
    approximateFactor: boolean;
    minimumClosedPackageReserve: Prisma.Decimal;
    autoOpenForUnitSale: boolean;
    products: Array<{ productId: string; isCanonical: boolean; conversionFactor: Prisma.Decimal }>;
  };
};

type InventoryBalanceRow = {
  branchId: string;
  productId: string;
  quantityOnHand: Prisma.Decimal;
  closedPackageQuantity: Prisma.Decimal;
  looseUnitQuantity: Prisma.Decimal;
  weightedAverageCost: Prisma.Decimal;
};

function buildConversionFromMember(member: StockGroupMemberRow): ProductStockConversion {
  const canonical = member.stockGroup.products.find((p) => p.isCanonical)
    ?? member.stockGroup.products.find((p) => new Prisma.Decimal(p.conversionFactor).eq(1))
    ?? member;
  return {
    stockGroupId: member.stockGroup.id,
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
  };
}

/**
 * Batch-load stock conversions and inventory balances for a list of products,
 * then map each product using pre-fetched data — eliminates N+1 queries.
 *
 * Old: N×3 Promise.all calls = up to 7 DB queries per product
 * New: 2 queries total (1 stock-group batch + 1 balance batch)
 */
async function batchMapProductsWithBranchInventory<TProduct extends CatalogProductWithBranchPricing>(
  products: TProduct[],
  branchId: string,
): Promise<ReturnType<typeof mapSingleProductWithBranchInventory<TProduct>>[]> {
  if (products.length === 0) return [];

  const productIds = products.map((p) => p.id);

  // 1. Batch-fetch stock group memberships for all productIds
  const members = await prisma.productStockGroupMember.findMany({
    where: { productId: { in: productIds }, isActive: true, stockGroup: { isActive: true } },
    include: {
      stockGroup: {
        include: {
          products: {
            where: { isActive: true },
            select: { productId: true, isCanonical: true, conversionFactor: true },
            orderBy: [{ isCanonical: "desc" }, { conversionFactor: "asc" }],
          },
        },
      },
    },
  }) as StockGroupMemberRow[];

  // Build conversion map keyed by productId
  const conversionByProductId = new Map<string, ProductStockConversion>();
  for (const member of members) {
    conversionByProductId.set(member.productId, buildConversionFromMember(member));
  }

  // Collect the canonical product IDs to fetch their balances
  const canonicalIds = new Set<string>();
  for (const conversion of conversionByProductId.values()) {
    canonicalIds.add(conversion.canonicalProductId);
  }
  // Also include products without a stock group (their own ID)
  for (const pid of productIds) {
    if (!conversionByProductId.has(pid)) canonicalIds.add(pid);
  }

  // 2. Batch-fetch inventory balances for (branchId, canonicalProductId)
  const balances = await prisma.inventoryBalance.findMany({
    where: { branchId, productId: { in: Array.from(canonicalIds) } },
    select: {
      branchId: true,
      productId: true,
      quantityOnHand: true,
      closedPackageQuantity: true,
      looseUnitQuantity: true,
      weightedAverageCost: true,
    },
  }) as InventoryBalanceRow[];

  const balanceByCanonicalId = new Map<string, InventoryBalanceRow>();
  for (const bal of balances) {
    balanceByCanonicalId.set(bal.productId, bal);
  }

  // 3. Batch-fetch the CANONICAL's own cost/price fields — solo lo necesitan
  // los miembros derivados (isCanonical=false), pero se busca para todo
  // canonicalIds en un solo query igual que balances. Sin esto, el costo/
  // precio efectivo de un miembro derivado seguía saliendo de sus propios
  // campos (el bug de fondo: prompt-costos-precios-fusion.md §1/§2.1).
  const [canonicalProducts, canonicalSettings] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: Array.from(canonicalIds) } },
      select: { id: true, standardSalePrice: true, globalCost: true, averageCost: true, lastPurchaseCost: true },
    }),
    prisma.branchProductSetting.findMany({
      where: { branchId, productId: { in: Array.from(canonicalIds) } },
      select: { branchId: true, productId: true, branchCost: true, branchPrice: true },
    }),
  ]);
  const canonicalProductById = new Map(canonicalProducts.map((p) => [p.id, p]));
  const canonicalSettingById = new Map(canonicalSettings.map((s) => [s.productId, s]));

  return products.map((product) => {
    const conversion = conversionByProductId.get(product.id) ?? null;
    const canonicalId = conversion?.canonicalProductId ?? product.id;
    const balance = balanceByCanonicalId.get(canonicalId) ?? null;
    const canonicalProduct = conversion && !conversion.isCanonical ? canonicalProductById.get(canonicalId) ?? null : null;
    const canonicalSetting = conversion && !conversion.isCanonical ? canonicalSettingById.get(canonicalId) ?? null : null;
    return mapSingleProductWithBranchInventory(product, branchId, conversion, balance, canonicalProduct, canonicalSetting);
  });
}

type CanonicalCostRow = {
  id: string;
  standardSalePrice: Prisma.Decimal;
  globalCost: Prisma.Decimal | null;
  averageCost: Prisma.Decimal | null;
  lastPurchaseCost: Prisma.Decimal | null;
};
type CanonicalBranchSettingRow = { branchId: string; productId: string; branchCost: Prisma.Decimal | null; branchPrice: Prisma.Decimal | null };

export function mapSingleProductWithBranchInventory<TProduct extends CatalogProductWithBranchPricing>(
  product: TProduct,
  branchId: string,
  conversion: ProductStockConversion | null,
  balance: InventoryBalanceRow | null,
  canonicalProduct: CanonicalCostRow | null = null,
  canonicalBranchSetting: CanonicalBranchSettingRow | null = null,
) {
  // Effective pricing from already-fetched branchProductSettings + inventoryBalances
  const branchSetting = product.branchProductSettings?.find((s) => s.branchId === branchId);
  const isFusionMember = Boolean(conversion && !conversion.isCanonical);
  const saleUnitWac = balance?.weightedAverageCost && conversion
    ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: balance.weightedAverageCost, conversionFactor: conversion.conversionFactor })
    : balance?.weightedAverageCost ?? null;

  const effective = resolveEffectivePricingFromParts({
    productId: product.id,
    standardSalePrice: product.standardSalePrice,
    globalCost: product.globalCost ?? null,
    averageCost: product.averageCost ?? null,
    lastPurchaseCost: product.lastPurchaseCost ?? null,
    branchPrice: branchSetting?.branchPrice ?? null,
    branchCost: branchSetting?.branchCost ?? null,
    weightedAverageCost: saleUnitWac,
    fusion: isFusionMember && conversion && canonicalProduct
      ? {
          conversionFactor: conversion.conversionFactor,
          canonicalBranchCost: canonicalBranchSetting?.branchCost ?? null,
          canonicalAverageCost: canonicalProduct.averageCost,
          canonicalGlobalCost: canonicalProduct.globalCost,
          canonicalLastPurchaseCost: canonicalProduct.lastPurchaseCost,
          canonicalBaseWeightedAverageCost: balance?.weightedAverageCost ?? null,
          canonicalBranchPrice: canonicalBranchSetting?.branchPrice ?? null,
          canonicalStandardSalePrice: canonicalProduct.standardSalePrice,
        }
      : null,
  });

  // Una sola resolución: `effective` ya sale del canónico cuando corresponde
  // (fusion arriba) y tiene el respaldo al precio estándar y la prioridad de
  // costo correctos (prompt-costos-precios-sucursal.md). Antes se calculaba
  // una segunda vez con mapProductWithEffectivePricing —ciega a la fusión,
  // sin convertir el WAC por factor— y se descartaba entera: `effective` ya
  // pisaba todos sus campos de precio/costo al spreadearse después. Cómputo
  // duplicado sin efecto observable; se borra en vez de "arreglarse".
  const { branchProductSettings: _branchProductSettings, inventoryBalances: _inventoryBalances, ...productData } = product;

  const dualStock = conversion && balance
    ? formatDualStock({
        baseQuantity: balance.quantityOnHand,
        conversionFactor: conversion.conversionFactor,
        baseUnit: conversion.baseUnit,
        saleUnit: conversion.saleUnit,
        closedPackageQuantity: balance.closedPackageQuantity,
        looseUnitQuantity: balance.looseUnitQuantity,
        packageUnit: conversion.packageUnit,
        tracksPackages: conversion.tracksPackages,
        minimumClosedPackageReserve: conversion.minimumClosedPackageReserve,
        autoOpenForUnitSale: conversion.autoOpenForUnitSale,
      })
    : null;

  const fallbackBalance = product.inventoryBalances?.find((item) => item.branchId === branchId);
  const fallbackQty = fallbackBalance?.quantityOnHand?.toNumber() ?? 0;

  // Bug: para cualquier miembro suelto que NO sea el canónico (ej. "Libra"
  // en una fusión Caja/Unidad/Libra) esto devolvía looseUnitQuantity crudo,
  // en unidad BASE (Unidad) — nunca dividido por el conversionFactor propio
  // de esa presentación. El canónico "funcionaba" de pura coincidencia
  // (su factor es 1), pero cualquier otra presentación suelta mostraba el
  // mismo número que el canónico en vez del suyo propio — "todo sale en
  // bulto", la Libra se veía con la misma cantidad que la Unidad.
  const packageAvailableSaleStock = conversion?.tracksPackages && balance
    ? conversion.isPackagePresentation
      ? balance.closedPackageQuantity.toNumber()
      : convertBaseQtyToSaleQty({
          baseQuantity: balance.looseUnitQuantity.add(
            conversion.autoOpenForUnitSale
              ? Prisma.Decimal.max(
                  0,
                  balance.closedPackageQuantity.sub(conversion.minimumClosedPackageReserve),
                ).mul(conversion.conversionFactorToBase ?? conversion.conversionFactor)
              : 0,
          ),
          conversionFactor: conversion.conversionFactor,
        }).toNumber()
    : null;

  const displaySaleStock = packageAvailableSaleStock
    ?? dualStock?.saleQuantity
    ?? balance?.quantityOnHand.toNumber()
    ?? fallbackQty;

  return {
    ...productData,
    ...effective,
    categoryName: product.category?.name ?? null,
    stockOnHand: displaySaleStock,
    availableStock: displaySaleStock,
    availableBaseStock: balance?.quantityOnHand.toNumber() ?? fallbackQty,
    availableSaleStock: displaySaleStock,
    baseUnit: conversion?.baseUnit ?? product.unit,
    saleUnit: conversion?.saleUnit ?? product.unit,
    stockConversion: conversion ? {
      stockGroupId: conversion.stockGroupId,
      stockGroupCode: conversion.stockGroupCode,
      stockGroupName: conversion.stockGroupName,
      baseUnit: conversion.baseUnit,
      saleUnit: conversion.saleUnit,
      conversionFactor: conversion.conversionFactor,
      conversionFactorToBase: conversion.conversionFactorToBase,
      tracksPackages: conversion.tracksPackages,
      packageUnit: conversion.packageUnit,
      minimumClosedPackageReserve: conversion.minimumClosedPackageReserve,
      autoOpenForUnitSale: conversion.autoOpenForUnitSale,
      isPackagePresentation: conversion.isPackagePresentation,
      isCanonical: conversion.isCanonical,
    } : null,
    sharedStock: dualStock,
  };
}

export async function listCategories() {
  return prisma.category.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function createCategory(input: {
  code: string;
  name: string;
  parentId?: string | null;
  actorUserId: string;
}) {
  const category = await prisma.category.create({
    data: {
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      parentId: input.parentId ?? null,
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "catalog",
    action: "CATEGORY_CREATE",
    entityType: "Category",
    entityId: category.id,
  });

  return category;
}

export async function updateCategory(categoryId: string, input: {
  code?: string;
  name?: string;
  parentId?: string | null;
  isActive?: boolean;
  actorUserId: string;
}) {
  // Validate code uniqueness if changing
  if (input.code?.trim()) {
    const normalizedCode = input.code.trim().toUpperCase();
    const existing = await prisma.category.findUnique({ where: { code: normalizedCode } });
    if (existing && existing.id !== categoryId) {
      throw new Error("VALIDATION_ERROR: El código de categoría ya existe.");
    }
  }

  const category = await prisma.category.update({
    where: { id: categoryId },
    data: {
      code: input.code?.trim().toUpperCase(),
      name: input.name?.trim(),
      parentId: input.parentId,
      isActive: input.isActive,
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "catalog",
    action: "CATEGORY_UPDATE",
    entityType: "Category",
    entityId: category.id,
    metadataJson: { isActive: category.isActive },
  });

  return category;
}

/**
 * Filtro de doble conteo: identifica productos que son miembros DERIVADOS
 * (no canónicos) de una fusión activa. Su inventario vive en el producto canónico
 * y su propio balance queda en cero físico. Por eso NO deben contarse ni
 * mostrarse como stock independiente en reportes, valorización, alertas de
 * reposición ni listados operativos — solo como equivalencias.
 *
 * Uso típico (excluir derivados):
 *   where: { product: { NOT: derivedStockGroupMemberFilter() }, ... }
 * o, sobre Product directamente:
 *   where: { NOT: derivedStockGroupMemberFilter(), ... }
 */
export function derivedStockGroupMemberFilter(): Prisma.ProductWhereInput {
  return {
    stockGroupMemberships: {
      some: { isActive: true, isCanonical: false, stockGroup: { isActive: true } },
    },
  };
}

/** Excluye los miembros derivados de una fusión activa (ver derivedStockGroupMemberFilter). */
export function excludeDerivedStockGroupMembers(): Prisma.ProductWhereInput {
  return { NOT: derivedStockGroupMemberFilter() };
}

/**
 * Branch-scope visibility filter: a product is relevant to a branch if it
 * satisfies at least one of the 4 conditions (stock, history, manual assignment,
 * or active inbound process). Products that satisfy none are hidden from that
 * branch's POS, catalog, and inventory views.
 */
export function branchProductScopeFilter(branchId: string): Prisma.ProductWhereInput {
  return {
    OR: [
      // 1. Has stock > 0 at this branch
      { inventoryBalances: { some: { branchId, quantityOnHand: { gt: 0 } } } },
      // 2. Has sale history at this branch
      { orderLines: { some: { saleOrder: { branchId } } } },
      // 3. Manually assigned as available at this branch
      { branchProductSettings: { some: { branchId, isAvailable: true } } },
      // 4. In active inbound transfer to this branch
      {
        transferLines: {
          some: {
            transfer: {
              toBranchId: branchId,
              status: { in: ["DRAFT", "APPROVED", "IN_TRANSIT"] },
            },
          },
        },
      },
    ],
  };
}

export async function listProducts(params: { q?: string; isActive?: boolean; branchId?: string; limit?: number; inStockOnly?: boolean; group?: boolean }) {
  const andClauses: Prisma.ProductWhereInput[] = [];

  if (params.branchId) andClauses.push(branchProductScopeFilter(params.branchId));

  if (params.q) {
    andClauses.push(
      buildProductSearchWhere<Prisma.ProductWhereInput>(params.q, ["sku", "name", "barcode", "category.name", "category.code"]),
    );
  }

  const where: Prisma.ProductWhereInput = {
    isActive: params.isActive,
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
  };

  const limit = params.limit ?? 1000;
  // El stock (fusión de paquetes/sueltas) se calcula DESPUÉS de traer los
  // productos — no es expresable en el WHERE de Prisma — así que cuando se
  // pide inStockOnly hay que sobre-pedir candidatos para no truncar de menos
  // si varios de los primeros N no tienen stock disponible.
  const fetchTake = params.inStockOnly && params.branchId ? Math.min(Math.max(limit * 5, 50), 500) : limit;

  const products = await prisma.product.findMany({
    where,
    include: {
      category: true,
      ...(params.branchId
        ? {
            branchProductSettings: {
              where: { branchId: params.branchId },
              select: { branchId: true, branchPrice: true, branchCost: true },
            },
            inventoryBalances: {
              where: { branchId: params.branchId },
              select: { branchId: true, quantityOnHand: true, closedPackageQuantity: true, looseUnitQuantity: true, weightedAverageCost: true },
            },
          }
        : {}),
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: fetchTake,
  });

  // Ranking en memoria (solo tiene sentido con búsqueda activa) + agrupación
  // por familia opcional (la pide el POS via ?group=true).
  function finalize<T extends { name: string; sku: string; category?: { name: string } | null }>(
    rows: T[],
  ): T[] | FamilyGroup<T>[] {
    const ranked = params.q ? rankProductMatches(rows, params.q) : rows;
    return params.group ? groupProductsByFamily(ranked) : ranked;
  }

  if (!params.branchId) return finalize(products);

  const mapped = await batchMapProductsWithBranchInventory(products, params.branchId);
  if (!params.inStockOnly) return finalize(mapped);

  // Oculta del POS lo que no se puede vender hoy (sin stock) — el producto
  // sigue existiendo en el catálogo, solo no aparece en la búsqueda del POS.
  const inStock = mapped.filter((p) => (p.availableSaleStock ?? 0) > 0).slice(0, limit);
  return finalize(inStock);
}

/**
 * Check if a SKU is available (not taken by another product).
 * Returns { available, normalizedSku, existingProductId? }
 */
export async function checkSkuAvailable(sku: string, excludeProductId?: string) {
  const normalized = normalizeManualSku(sku);
  if (!normalized) return { available: true, normalizedSku: "", existingProductId: null };

  const existing = await prisma.product.findUnique({
    where: { sku: normalized },
    select: { id: true, sku: true, name: true },
  });

  if (!existing) return { available: true, normalizedSku: normalized, existingProductId: null };
  if (excludeProductId && existing.id === excludeProductId) return { available: true, normalizedSku: normalized, existingProductId: null };

  return { available: false, normalizedSku: normalized, existingProductId: existing.id, existingProductName: existing.name };
}

/**
 * Preview auto-generated SKU for a product name + category.
 */
export async function previewAutoSku(input: { productName: string; categoryId: string }) {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { code: true, name: true },
  });
  const sku = await generateSkuForProduct(prisma, {
    productName: input.productName,
    categoryName: category?.name ?? null,
  });
  return { sku };
}

export async function suggestProductSku(input: { productName: string; categoryId: string; productId?: string }) {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { code: true, name: true, isActive: true },
  });
  if (!category?.isActive) throw new Error("VALIDATION_ERROR: categoria invalida o inactiva.");

  const suggestedSku = await generateSkuForProduct(prisma, {
    productName: input.productName,
    categoryName: category.name,
  });
  const availability = await checkSkuAvailable(suggestedSku, input.productId);

  return {
    suggestedSku,
    categoryCode: category.code,
    reason: `SKU sugerido por categoria ${category.name} y nombre del producto.`,
    isAvailable: availability.available,
  };
}

export async function createProduct(input: {
  sku?: string | null;
  barcode?: string | null;
  name: string;
  description?: string | null;
  categoryId: string;
  unit: string;
  allowsFraction: boolean;
  standardSalePrice: number;
  isTimber: boolean;
  actorUserId: string;
}) {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true, name: true, isActive: true },
  });
  if (!category?.isActive) throw new Error("VALIDATION_ERROR: categoria invalida o inactiva.");

  // Validate manual SKU uniqueness before generation
  if (input.sku?.trim()) {
    const check = await checkSkuAvailable(input.sku);
    if (!check.available) {
      throw new Error(`VALIDATION_ERROR: El SKU "${check.normalizedSku}" ya existe (producto: ${check.existingProductName}).`);
    }
  }

  const sku = await generateSkuForProduct(prisma, {
    productName: input.name,
    categoryName: category.name,
    sku: input.sku,
  });
  if (!sku) throw new Error("VALIDATION_ERROR: no se pudo generar un SKU valido.");

  const product = await prisma.product.create({
    data: {
      sku,
      barcode: input.barcode ?? null,
      name: input.name.trim(),
      description: input.description ?? null,
      categoryId: input.categoryId,
      unit: input.unit.trim(),
      allowsFraction: input.allowsFraction,
      standardSalePrice: new Prisma.Decimal(input.standardSalePrice),
      isTimber: input.isTimber,
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "catalog",
    action: "PRODUCT_CREATE",
    entityType: "Product",
    entityId: product.id,
  });

  return product;
}

/**
 * prompt-precios-costos-una-sola-fuente.md — pura, sin DB: aislada para
 * poder probar el sync sin base de datos, mismo principio que
 * decidePriceBandPath/isPriceStaleAgainstCost en otros módulos.
 *
 * "el margen no cuadra" — resolveCatalogDisplayCost (catalog-inventory/
 * service.ts) Y resolveCostChain (catalog/effective-pricing.ts) priorizan
 * averageCost SOBRE globalCost cuando averageCost no es null.
 * updateGlobalProductCostForReceiptTx (purchase-orders/service.ts, recibir
 * una orden de compra) SIEMPRE escribe los dos campos al mismo valor — su
 * propio test (global-cost-update.test.ts) lo deja explícito: "un solo
 * precio de compra para toda la empresa". Esta función existía en
 * updateProduct escribiendo SOLO globalCost: para cualquier producto que
 * alguna vez recibió una compra (averageCost ya no es null), la edición
 * manual de "Costo de compra" quedaba tapada para siempre por el
 * averageCost viejo — se guarda bien, el input muestra el valor nuevo, pero
 * el costo efectivo en TODAS las pantallas (Precios y costos, POS, Brain,
 * la Bandeja) seguía calculando con el costo de la última compra real.
 */
export function buildGlobalCostUpdateFields(input: { globalCost: number | null | undefined; actorUserId: string; now: Date }): {
  globalCost: Prisma.Decimal | null | undefined;
  averageCost: Prisma.Decimal | null | undefined;
  costUpdatedAt: Date | undefined;
  costUpdatedByUserId: string | undefined;
  costSource: "GLOBAL" | null | undefined;
} {
  if (input.globalCost === undefined) {
    return { globalCost: undefined, averageCost: undefined, costUpdatedAt: undefined, costUpdatedByUserId: undefined, costSource: undefined };
  }
  const decimalValue = input.globalCost === null ? null : new Prisma.Decimal(input.globalCost);
  return {
    globalCost: decimalValue,
    averageCost: decimalValue,
    costUpdatedAt: input.now,
    costUpdatedByUserId: input.actorUserId,
    costSource: decimalValue === null ? null : "GLOBAL",
  };
}

/**
 * "el ultimo costo que se meta es el que gana en las fusiones... con las
 * derivadas y la factorización equivalente al producto se ajuste" — entrar
 * el costo por CUALQUIER presentación de una fusión (no solo la canónica),
 * y que el factor YA VALIDADO de esa fusión lo convierta, en vez de
 * bloquear con FUSION_COST_WRITE_NOT_ALLOWED y obligar a hacer la división
 * a mano en otra pantalla — exactamente el tipo de conversión manual que
 * originó buena parte de los datos mal cargados de esta sesión (piedrín,
 * arena: alguien sabe el costo del quintal/metro, no el de la varilla/lata
 * suelta, y tiene que convertir en la cabeza antes de poder escribirlo).
 *
 * Pura, sin DB — aislada para probar la conversión exacta sin base de
 * datos, mismo principio que buildGlobalCostUpdateFields. Sigue habiendo
 * UNA sola fuente de verdad — el canónico — y un derivado SIGUE sin
 * guardar nunca un costo propio: "1 quintal = 780, 1 quintal = 30
 * varillas" redirige a escribir 26 en la varilla (canónico), no 780 en el
 * quintal. Esto NO es "el último que se guarda gana tal cual" (eso
 * reabriría el desfase 18.6× de arena: un valor sin convertir pisando el
 * WAC real) — es "el último que se guarda, convertido por el factor
 * conocido, es la fuente" — el canónico sigue siendo el único lugar donde
 * el costo realmente vive.
 */
export function resolveGlobalCostWriteTarget(input: {
  requestedProductId: string;
  enteredCost: number;
  conversion: { isCanonical: boolean; canonicalProductId: string; conversionFactor: Prisma.Decimal | number } | null | undefined;
}): { targetProductId: string; costForTarget: number; redirected: boolean } {
  if (!input.conversion || input.conversion.isCanonical) {
    return { targetProductId: input.requestedProductId, costForTarget: input.enteredCost, redirected: false };
  }
  const factor = Number(input.conversion.conversionFactor);
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error("VALIDATION_ERROR: El factor de conversión de esta presentación no es válido.");
  }
  return { targetProductId: input.conversion.canonicalProductId, costForTarget: input.enteredCost / factor, redirected: true };
}

export async function updateProduct(productId: string, input: {
  sku?: string;
  skuUpdateMode?: "KEEP_CURRENT" | "USE_SUGGESTED";
  suggestedSku?: string;
  barcode?: string | null;
  name?: string;
  description?: string | null;
  categoryId?: string;
  unit?: string;
  allowsFraction?: boolean;
  standardSalePrice?: number;
  isActive?: boolean;
  globalCost?: number | null;
  allowHighUnitCost?: boolean;
  /** Confirma explícitamente un standardSalePrice que se desvía >15% del precio implícito de fusión (Parte A.2) — mismo patrón que overridePriceConfirmed para branchPrice. */
  overridePriceConfirmed?: boolean;
  actorUserId: string;
}) {
  const previous = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, categoryId: true, category: { select: { name: true } }, standardSalePrice: true, globalCost: true },
  });
  if (!previous) throw new Error("NOT_FOUND");

  // "el ultimo costo que se meta es el que gana en las fusiones... con las
  // derivadas y la factorización equivalente al producto se ajuste" — el
  // costo de un miembro DERIVADO de una fusión sigue viviendo SOLO en el
  // canónico (prompt-costos-precios-fusion.md §2.1 — el bug de fondo era la
  // LATA DE ARENA con globalCost=1.00 tapando el WAC real del canónico, y
  // eso sigue exactamente igual de prohibido), pero ya no se rechaza el
  // pedido sin más: se REDIRIGE, convertido por el factor de esta fusión —
  // ya validado al crear/editar la fusión, no algo que se inventa acá — al
  // canónico. resolveGlobalCostWriteTarget decide a dónde y con qué valor.
  let costRedirect: { targetProductId: string; costForTarget: number } | null = null;
  const needsConversionLookup = (input.globalCost !== undefined && input.globalCost !== null) || input.standardSalePrice !== undefined;
  const conversion = needsConversionLookup ? await getProductStockConversion(prisma, productId) : null;

  // "que el WAC deje de moverse sin que nadie lo decida" ya distinguió costo
  // (un hecho físico, uno por grupo) de WAC. Esta vuelta distingue costo de
  // PRECIO: el costo de un derivado SIGUE redirigiéndose al canónico (abajo,
  // sin tocar) porque hay UN material físico y UN costo real. El precio es
  // una decisión comercial POR PRESENTACIÓN — vender el metro más barato por
  // lata que la lata suelta es descuento por volumen legítimo, no un error a
  // corregir empujándolo a todo el grupo. standardSalePrice de un derivado
  // se escribe SIEMPRE en el producto solicitado, nunca se redirige.
  //
  // Lo que SÍ se hace es avisar (no bloquear) cuando el precio tecleado se
  // desvía mucho del implícito (canónico × factor) — para que la decisión
  // sea visible, no silenciosa. Mismo mecanismo que branchPrice
  // (FUSION_PRICE_OVERRIDE_CONFIRMATION_REQUIRED, catalog-inventory/service.ts),
  // reusado acá con su propio umbral y su propio flag de confirmación.
  if (input.standardSalePrice !== undefined && conversion && !conversion.isCanonical && !input.overridePriceConfirmed) {
    const canonicalProduct = await prisma.product.findUnique({
      where: { id: conversion.canonicalProductId },
      select: { sku: true, standardSalePrice: true, globalCost: true, averageCost: true, lastPurchaseCost: true },
    });
    if (canonicalProduct) {
      const factor = Number(conversion.conversionFactor);
      const balances = await prisma.inventoryBalance.findMany({
        where: { productId: conversion.canonicalProductId },
        select: { quantityOnHand: true, weightedAverageCost: true },
      });
      const canonicalWac = aggregateWeightedAverageCost(
        balances.map((b) => ({ quantityOnHand: Number(b.quantityOnHand), weightedAverageCost: Number(b.weightedAverageCost) })),
      );
      const effectiveCostRaw = resolveCatalogDisplayCost({
        wac: canonicalWac,
        averageCost: canonicalProduct.averageCost,
        globalCost: canonicalProduct.globalCost,
        lastPurchaseCost: canonicalProduct.lastPurchaseCost,
        factor,
      });
      const deviationCheck = evaluatePriceDeviationFromFusion({
        enteredPrice: input.standardSalePrice,
        canonicalStandardSalePrice: Number(canonicalProduct.standardSalePrice),
        conversionFactor: factor,
        effectiveCost: effectiveCostRaw > 0 ? effectiveCostRaw : null,
        confirmed: input.overridePriceConfirmed,
      });
      if (deviationCheck.deviates) throw new Error(deviationCheck.message!);
    }
  }

  if (input.globalCost !== undefined && input.globalCost !== null) {
    const resolved = resolveGlobalCostWriteTarget({
      requestedProductId: productId,
      enteredCost: input.globalCost,
      conversion,
    });
    if (resolved.redirected) costRedirect = { targetProductId: resolved.targetProductId, costForTarget: resolved.costForTarget };

    // "asegura el motor de mejor manera" — un producto que a veces se
    // compra suelto y a veces en bulto (HIERRO: a veces varilla, a veces
    // tercio de 30) puede terminar con el costo del BULTO tecleado a mano
    // en el campo de costo del CANÓNICO (por unidad base) — exactamente la
    // confusión que corrompe el costo derivado de todo el grupo, porque
    // TODOS los derivados calculan desde acá. wac.ts ya tiene este guard
    // (detectPackageCostAsUnitCost) para movimientos de inventario
    // (compras, ajustes) — nunca corría en esta pantalla, que edita el
    // costo directo sin pasar por un movimiento. Solo aplica al canónico
    // de un grupo con presentaciones de escala real (factor >= 4, mismo
    // umbral que el guard de movimientos) — un producto suelto o sin
    // fusión no tiene con qué confundirse. NO aplica cuando se redirige
    // desde un derivado: ahí no hay ambigüedad que atrapar — se sabe con
    // certeza qué presentación se tecleó, la conversión es exacta por el
    // factor ya validado, no una sospecha sobre un campo único que podría
    // significar dos cosas distintas.
    if (conversion?.isCanonical) {
      const siblings = await prisma.productStockGroupMember.findMany({
        where: { stockGroupId: conversion.stockGroupId, isActive: true, isCanonical: false },
        select: { conversionFactor: true },
      });
      const packageFactor = maxPackageFactorForSanityCheck(siblings.map((s) => s.conversionFactor));
      if (packageFactor) {
        const wacAgg = await prisma.inventoryBalance.aggregate({
          where: { productId },
          _max: { weightedAverageCost: true },
        });
        const referenceWac = wacAgg._max.weightedAverageCost;
        if (referenceWac) {
          detectPackageCostAsUnitCost({
            inbound: true,
            baseMovementUnitCost: new Prisma.Decimal(input.globalCost),
            existingWac: referenceWac,
            packageFactor,
            allowHighUnitCost: input.allowHighUnitCost,
          });
        }
      }
    }
  }

  // Auditoría 2026-07-22 (ALTO Catálogo): bloqueo de precio bajo costo,
  // ausente hasta ahora en la edición de producto global.
  //
  // "revisa todo completo" (bug reportado dos veces, captura de Precios y
  // costos) — este chequeo comparaba el costo nuevo contra standardSalePrice,
  // el precio GENERAL del producto. Verificado en todo el frontend: NO
  // existe ningún editor de standardSalePrice para un producto ya creado —
  // se fija una sola vez, en el formulario "Crear producto", y nunca más.
  // Cuando se edita SOLO el costo de compra (el único camino real que toca
  // este código), el bloqueo era un callejón sin salida: "corrige el costo
  // y el precio juntos" (el propósito original de este guard, ver arriba)
  // es imposible de cumplir para un precio que no tiene dónde corregirse.
  //
  // El riesgo que prevenía — una sucursal SIN precio propio vendiendo bajo
  // costo por el respaldo a standardSalePrice (STANDARD en effective-
  // pricing.ts) — sigue visible, no silenciado: son exactamente los badges
  // "Precio bajo costo" / margen en rojo que ya muestran Precios y costos,
  // Precios vigentes y la bandeja. Mismo criterio que "margen bajo la
  // política de categoría": se avisa, no se bloquea sin salida — la
  // diferencia con el resto de los casos de este guard (edición conjunta,
  // precio de sucursal, importación) es que ESOS sí tienen con qué
  // corregirse en el acto; este no.
  if (input.standardSalePrice !== undefined || input.globalCost !== undefined) {
    const nextPrice = input.standardSalePrice !== undefined ? input.standardSalePrice : Number(previous.standardSalePrice);
    const nextCost = input.globalCost !== undefined
      ? input.globalCost
      : (previous.globalCost === null ? null : Number(previous.globalCost));
    const editingCostAlone = input.standardSalePrice === undefined && input.globalCost !== undefined;
    if (!editingCostAlone) {
      assertPriceNotBelowCost({ price: nextPrice, cost: nextCost });
    }
  }

  let nextCategory: { id: string; name: string; isActive: boolean } | null = null;
  if (input.categoryId) {
    nextCategory = await prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true, name: true, isActive: true },
    });
    if (!nextCategory?.isActive) throw new Error("VALIDATION_ERROR: categoria invalida o inactiva.");
  }

  let nextSku: string | undefined;
  const requestedSku = input.skuUpdateMode === "USE_SUGGESTED" ? input.suggestedSku : input.sku;
  if (requestedSku !== undefined && input.skuUpdateMode !== "KEEP_CURRENT") {
    const normalizedSku = normalizeManualSku(requestedSku);
    if (!normalizedSku) throw new Error("VALIDATION_ERROR: SKU invalido.");
    const check = await checkSkuAvailable(normalizedSku, productId);
    if (!check.available) {
      throw new Error(`VALIDATION_ERROR: El SKU "${check.normalizedSku}" ya existe (producto: ${check.existingProductName}).`);
    }
    nextSku = normalizedSku;
  }

  const now = new Date();
  // El costo del producto SOLICITADO solo se toca cuando NO hay redirección
  // (producto suelto, o el propio canónico) — un derivado sigue sin guardar
  // jamás su propio costo: hay UN material físico, UN costo real. El PRECIO
  // ya no sigue esta regla (Parte A) — standardSalePrice se escribe SIEMPRE
  // en el producto solicitado, sea canónico o derivado: es una decisión
  // comercial por presentación, no un hecho físico compartido.
  const globalCostFields = costRedirect
    ? { globalCost: undefined, averageCost: undefined, costUpdatedAt: undefined, costUpdatedByUserId: undefined, costSource: undefined }
    : buildGlobalCostUpdateFields({ globalCost: input.globalCost, actorUserId: input.actorUserId, now });
  const standardSalePriceForRequested = input.standardSalePrice === undefined
    ? undefined
    : new Prisma.Decimal(input.standardSalePrice);

  // La escritura al canónico (SOLO si hubo redirección de costo) va en la
  // MISMA transacción que la del producto solicitado: si una falla, la otra
  // no debe quedar aplicada sola con un valor a medio redirigir.
  const { product, canonicalUpdate } = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: productId },
      data: {
        sku: nextSku,
        barcode: input.barcode,
        name: input.name?.trim(),
        description: input.description,
        categoryId: input.categoryId,
        unit: input.unit?.trim(),
        allowsFraction: input.allowsFraction,
        standardSalePrice: standardSalePriceForRequested,
        isActive: input.isActive,
        ...globalCostFields,
      },
    });

    let canonicalUpdate: { productId: string; sku: string; newCost: number } | null = null;
    if (costRedirect) {
      const canonicalCostFields = buildGlobalCostUpdateFields({ globalCost: costRedirect.costForTarget, actorUserId: input.actorUserId, now });
      const canonicalProduct = await tx.product.update({
        where: { id: costRedirect.targetProductId },
        data: canonicalCostFields,
        select: { id: true, sku: true },
      });
      canonicalUpdate = {
        productId: canonicalProduct.id,
        sku: canonicalProduct.sku,
        newCost: costRedirect.costForTarget,
      };
    }

    return { product: updated, canonicalUpdate };
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "catalog",
    action: previous.categoryId !== product.categoryId && previous.sku !== product.sku
      ? "PRODUCT_CATEGORY_AND_SKU_CHANGED"
      : previous.categoryId !== product.categoryId
        ? "PRODUCT_CATEGORY_CHANGED"
        : previous.sku !== product.sku
          ? "PRODUCT_SKU_CHANGED"
          : "PRODUCT_UPDATE",
    entityType: "Product",
    entityId: product.id,
    metadataJson: {
      isActive: product.isActive,
      oldSku: previous.sku,
      newSku: product.sku,
      oldCategoryId: previous.categoryId,
      newCategoryId: product.categoryId,
      oldCategoryName: previous.category?.name ?? null,
      newCategoryName: nextCategory?.name ?? previous.category?.name ?? null,
      skuChanged: previous.sku !== product.sku,
      categoryChanged: previous.categoryId !== product.categoryId,
      skuUpdateMode: input.skuUpdateMode ?? "KEEP_CURRENT",
      ...(canonicalUpdate ? {
        costEnteredViaDerivedPresentation: true,
        canonicalProductId: canonicalUpdate.productId,
        canonicalSku: canonicalUpdate.sku,
        enteredCost: input.globalCost,
        canonicalCostApplied: canonicalUpdate.newCost,
      } : {}),
    },
  });

  // Trazabilidad del lado del canónico también — quien revise SU auditoría
  // (no la del derivado por el que se entró el dato) tiene que poder ver
  // de dónde vino el cambio, igual que ya hace updateGlobalProductCostForReceiptTx
  // para las recepciones de compra. Solo costo: el precio (Parte A) ya no
  // se redirige, así que el canónico nunca cambia de precio por esta vía.
  if (canonicalUpdate) {
    await logAuditEvent({
      actorUserId: input.actorUserId,
      module: "catalog",
      action: "PRODUCT_GLOBAL_COST_UPDATED",
      entityType: "Product",
      entityId: canonicalUpdate.productId,
      metadataJson: {
        newGlobalCost: canonicalUpdate.newCost,
        source: "DERIVED_PRESENTATION_COST_ENTRY",
        enteredViaProductId: product.id,
        enteredViaSku: product.sku,
        enteredCost: input.globalCost,
      },
    });
  }

  // Parte B.1 — "ninguna escritura de precio queda sin rastro". Toda
  // escritura de standardSalePrice, sin excepción, deja PRODUCT_PRICE_CHANGED
  // con el antes/después, quién, y el origen (esta función sirve tanto a
  // Precios y costos como al panel de Fusiones, de ahí la distinción).
  if (input.standardSalePrice !== undefined && Number(previous.standardSalePrice) !== input.standardSalePrice) {
    await logAuditEvent({
      actorUserId: input.actorUserId,
      module: "catalog",
      action: "PRODUCT_PRICE_CHANGED",
      entityType: "Product",
      entityId: product.id,
      metadataJson: {
        productId: product.id,
        sku: product.sku,
        previousPrice: Number(previous.standardSalePrice),
        newPrice: input.standardSalePrice,
        field: "standardSalePrice",
        origin: conversion && !conversion.isCanonical ? "fusion" : "catalogo",
        deviationConfirmed: Boolean(input.overridePriceConfirmed),
      },
    });
  }

  return product;
}



/**
 * Delete product if it has no sales/movements, otherwise deactivate it.
 * Returns { action: "DELETED" | "DEACTIVATED", reason: string }
 */
export async function deleteOrDeactivateProduct(productId: string, actorUserId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true, isActive: true },
  });
  if (!product) throw new Error("NOT_FOUND");

  // Check for sales
  const salesCount = await prisma.saleOrderLine.count({ where: { productId } });
  // Check for inventory movements
  const movementsCount = await prisma.inventoryMovement.count({ where: { productId } });
  // Check for transfer lines
  const transfersCount = await prisma.transferLine.count({ where: { productId } });

  const hasDependencies = salesCount > 0 || movementsCount > 0 || transfersCount > 0;

  if (hasDependencies) {
    // Deactivate instead of deleting
    await prisma.product.update({
      where: { id: productId },
      data: { isActive: false },
    });

    const reasons: string[] = [];
    if (salesCount > 0) reasons.push(`${salesCount} venta(s)`);
    if (movementsCount > 0) reasons.push(`${movementsCount} movimiento(s)`);
    if (transfersCount > 0) reasons.push(`${transfersCount} transferencia(s)`);

    await logAuditEvent({
      actorUserId,
      module: "catalog",
      action: "PRODUCT_DEACTIVATE",
      entityType: "Product",
      entityId: productId,
      metadataJson: { reason: "has_dependencies", salesCount, movementsCount, transfersCount },
    });

    return {
      action: "DEACTIVATED" as const,
      reason: `Producto desactivado porque tiene ${reasons.join(", ")} asociadas. No se puede eliminar.`,
    };
  }

  // Safe to hard delete — clean up related records first
  await prisma.$transaction(async (tx) => {
    await tx.branchProductSetting.deleteMany({ where: { productId } });
    await tx.inventoryBalance.deleteMany({ where: { productId } });
    await tx.stockReorderPolicy.deleteMany({ where: { productId } });
    await tx.reorderAlert.deleteMany({ where: { productId } });
    await tx.reorderSuggestionLine.deleteMany({ where: { productId } });
    await tx.productPricing.deleteMany({ where: { productId } });
    await tx.productAnalytics.deleteMany({ where: { productId } });
    await tx.brainDecision.deleteMany({ where: { productId } });
    await tx.product.delete({ where: { id: productId } });
  });

  await logAuditEvent({
    actorUserId,
    module: "catalog",
    action: "PRODUCT_DELETE",
    entityType: "Product",
    entityId: productId,
    metadataJson: { sku: product.sku, name: product.name },
  });

  return {
    action: "DELETED" as const,
    reason: "Producto eliminado permanentemente (sin ventas ni movimientos).",
  };
}

/**
 * Delete category if it has no products/movements, otherwise deactivate it.
 * Returns { action: "DELETED" | "DEACTIVATED", reason: string }
 */
export async function deleteOrDeactivateCategory(categoryId: string, actorUserId: string) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, code: true, name: true, isActive: true },
  });
  if (!category) throw new Error("NOT_FOUND");

  // Check for products in this category
  const productsCount = await prisma.product.count({ where: { categoryId } });

  if (productsCount > 0) {
    // Deactivate instead of deleting
    await prisma.category.update({
      where: { id: categoryId },
      data: { isActive: false },
    });

    await logAuditEvent({
      actorUserId,
      module: "catalog",
      action: "CATEGORY_DEACTIVATE",
      entityType: "Category",
      entityId: categoryId,
      metadataJson: { reason: "has_products", productsCount },
    });

    return {
      action: "DEACTIVATED" as const,
      reason: `Categoría desactivada porque tiene ${productsCount} producto(s) asociado(s). No se puede eliminar.`,
    };
  }

  // Safe to hard delete
  await prisma.category.delete({ where: { id: categoryId } });

  await logAuditEvent({
    actorUserId,
    module: "catalog",
    action: "CATEGORY_DELETE",
    entityType: "Category",
    entityId: categoryId,
    metadataJson: { code: category.code, name: category.name },
  });

  return {
    action: "DELETED" as const,
    reason: "Categoría eliminada permanentemente (sin productos asociados).",
  };
}

export async function getTopSellingProducts(params: { limit?: number; isActive?: boolean; branchId?: string; inStockOnly?: boolean }) {
  const limit = params.limit ?? 5;
  // Ver comentario en listProducts: se sobre-pide para no truncar de menos
  // cuando varios de los top-sellers no tienen stock en esta sucursal.
  const fetchTake = params.inStockOnly && params.branchId ? Math.min(Math.max(limit * 5, 50), 500) : limit;
  const include = {
    category: true,
    ...(params.branchId
      ? {
          branchProductSettings: {
            where: { branchId: params.branchId },
            select: { branchId: true, branchPrice: true, branchCost: true },
          },
          inventoryBalances: {
            where: { branchId: params.branchId },
            select: { branchId: true, quantityOnHand: true, closedPackageQuantity: true, looseUnitQuantity: true, weightedAverageCost: true },
          },
        }
      : {}),
  };

  // Get the top-selling product IDs by aggregating sale order lines
  const topLines = await prisma.saleOrderLine.groupBy({
    by: ["productId"],
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: fetchTake,
  });

  if (topLines.length === 0) {
    // Fallback: return first N active products if no sales yet
    const fallbackProducts = await prisma.product.findMany({
      where: { isActive: params.isActive },
      include,
      orderBy: { name: "asc" },
      take: fetchTake,
    });
    if (!params.branchId) return fallbackProducts;
    const mappedFallback = await batchMapProductsWithBranchInventory(fallbackProducts, params.branchId);
    return params.inStockOnly
      ? mappedFallback.filter((p) => (p.availableSaleStock ?? 0) > 0).slice(0, limit)
      : mappedFallback;
  }

  const productIds = topLines.map((line) => line.productId);
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    },
    include,
  });

  // Sort by sales volume (same order as topLines)
  const idOrder = new Map(productIds.map((id, idx) => [id, idx]));
  products.sort((a, b) => (idOrder.get(a.id) ?? 99) - (idOrder.get(b.id) ?? 99));

  if (!params.branchId) return products;
  const mapped = await batchMapProductsWithBranchInventory(products, params.branchId);
  return params.inStockOnly
    ? mapped.filter((p) => (p.availableSaleStock ?? 0) > 0).slice(0, limit)
    : mapped;
}
