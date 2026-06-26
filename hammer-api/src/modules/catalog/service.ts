import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { generateSkuForProduct, normalizeManualSku } from "@/modules/catalog/sku-generator";
import { mapProductWithEffectivePricing, resolveEffectivePricingFromParts } from "@/modules/catalog/effective-pricing";
import { formatDualStock } from "@/modules/inventory/unit-conversion";
import type { ProductStockConversion } from "@/modules/inventory/unit-conversion";

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

  return products.map((product) => {
    const conversion = conversionByProductId.get(product.id) ?? null;
    const canonicalId = conversion?.canonicalProductId ?? product.id;
    const balance = balanceByCanonicalId.get(canonicalId) ?? null;
    return mapSingleProductWithBranchInventory(product, branchId, conversion, balance);
  });
}

function mapSingleProductWithBranchInventory<TProduct extends CatalogProductWithBranchPricing>(
  product: TProduct,
  branchId: string,
  conversion: ProductStockConversion | null,
  balance: InventoryBalanceRow | null,
) {
  // Effective pricing from already-fetched branchProductSettings + inventoryBalances
  const branchSetting = product.branchProductSettings?.find((s) => s.branchId === branchId);
  const saleUnitWac = balance?.weightedAverageCost && conversion
    ? balance.weightedAverageCost.mul(conversion.conversionFactor)
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
  });

  const mapped = mapProductWithEffectivePricing(product, branchId);

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

  const packageAvailableSaleStock = conversion?.tracksPackages && balance
    ? conversion.isPackagePresentation
      ? balance.closedPackageQuantity.toNumber()
      : balance.looseUnitQuantity
          .add(
            conversion.autoOpenForUnitSale
              ? Prisma.Decimal.max(
                  0,
                  balance.closedPackageQuantity.sub(conversion.minimumClosedPackageReserve),
                ).mul(conversion.conversionFactorToBase ?? conversion.conversionFactor)
              : 0,
          )
          .toNumber()
    : null;

  const displaySaleStock = packageAvailableSaleStock
    ?? dualStock?.saleQuantity
    ?? balance?.quantityOnHand.toNumber()
    ?? fallbackQty;

  return {
    ...mapped,
    categoryName: product.category?.name ?? null,
    effectiveCost: effective.effectiveCost,
    weightedAverageCost: effective.weightedAverageCost,
    stockOnHand: displaySaleStock,
    availableStock: displaySaleStock,
    availableBaseStock: balance?.quantityOnHand.toNumber() ?? fallbackQty,
    availableSaleStock: displaySaleStock,
    baseUnit: conversion?.baseUnit ?? (mapped as { unit: string }).unit,
    saleUnit: conversion?.saleUnit ?? (mapped as { unit: string }).unit,
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

export async function listProducts(params: { q?: string; isActive?: boolean; branchId?: string; limit?: number }) {
  const andClauses: Prisma.ProductWhereInput[] = [];

  if (params.branchId) andClauses.push(branchProductScopeFilter(params.branchId));

  if (params.q) {
    andClauses.push({
      OR: [
        { sku: { contains: params.q, mode: "insensitive" } },
        { name: { contains: params.q, mode: "insensitive" } },
        { barcode: { contains: params.q, mode: "insensitive" } },
        { category: { name: { contains: params.q, mode: "insensitive" } } },
        { category: { code: { contains: params.q, mode: "insensitive" } } },
      ],
    });
  }

  const where: Prisma.ProductWhereInput = {
    isActive: params.isActive,
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
  };

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
    take: params.limit ?? 1000,
  });

  if (!params.branchId) return products;

  return batchMapProductsWithBranchInventory(products, params.branchId);
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
  actorUserId: string;
}) {
  const previous = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, categoryId: true, category: { select: { name: true } } },
  });
  if (!previous) throw new Error("NOT_FOUND");

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

  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      sku: nextSku,
      barcode: input.barcode,
      name: input.name?.trim(),
      description: input.description,
      categoryId: input.categoryId,
      unit: input.unit?.trim(),
      allowsFraction: input.allowsFraction,
      standardSalePrice: input.standardSalePrice !== undefined ? new Prisma.Decimal(input.standardSalePrice) : undefined,
      isActive: input.isActive,
      globalCost: input.globalCost !== undefined ? (input.globalCost === null ? null : new Prisma.Decimal(input.globalCost)) : undefined,
      costUpdatedAt: input.globalCost !== undefined ? new Date() : undefined,
      costUpdatedByUserId: input.globalCost !== undefined ? input.actorUserId : undefined,
      costSource: input.globalCost !== undefined ? (input.globalCost === null ? null : "GLOBAL") : undefined,
    },
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
    },
  });

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

export async function getTopSellingProducts(params: { limit?: number; isActive?: boolean; branchId?: string }) {
  const limit = params.limit ?? 5;
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
    take: limit,
  });

  if (topLines.length === 0) {
    // Fallback: return first N active products if no sales yet
    const fallbackProducts = await prisma.product.findMany({
      where: { isActive: params.isActive },
      include,
      orderBy: { name: "asc" },
      take: limit,
    });
    return params.branchId ? batchMapProductsWithBranchInventory(fallbackProducts, params.branchId) : fallbackProducts;
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

  return params.branchId ? batchMapProductsWithBranchInventory(products, params.branchId) : products;
}
