import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { generateSkuForProduct, normalizeManualSku } from "@/modules/catalog/sku-generator";
import { resolveEffectivePricing } from "@/modules/catalog/effective-pricing";
import {
  convertBaseQtyToSaleQty,
  convertBaseUnitCostToSaleUnitCost,
  formatDualStock,
  getProductStockConversionsBatch,
  type ProductStockConversion,
} from "@/modules/inventory/unit-conversion";

type CatalogProductWithBranchPricing = {
  id: string;
  unit: string;
  name?: string;
  sku?: string;
  barcode?: string | null;
  standardSalePrice: Prisma.Decimal;
  branchProductSettings?: Array<{ branchId: string; branchPrice: Prisma.Decimal | null; branchCost: Prisma.Decimal | null }>;
  inventoryBalances?: Array<{ branchId: string; quantityOnHand?: Prisma.Decimal | null; weightedAverageCost: Prisma.Decimal }>;
  category?: { id: string; code?: string; name: string } | null;
};

const ZERO = new Prisma.Decimal(0);

/**
 * Synchronously build the branch-scoped catalog row for a single product using data that has
 * already been loaded in bulk (branch settings + inventory balances from the main query, plus
 * the pre-loaded stock-conversion map and shared-balance map). This is the key to fixing the
 * N+1 query problem that made the POS catalog slow (~6s) and occasionally fail.
 */
function buildBranchProductRow<TProduct extends CatalogProductWithBranchPricing>(
  product: TProduct,
  branchId: string,
  conversion: ProductStockConversion | null,
  sharedBalanceMap: Map<string, { quantityOnHand: Prisma.Decimal | null; weightedAverageCost: Prisma.Decimal }>,
) {
  const branchSetting = product.branchProductSettings?.find((setting) => setting.branchId === branchId);
  const ownBalance = product.inventoryBalances?.find((balance) => balance.branchId === branchId);

  // For products that belong to a shared stock group (e.g. iron quintal/varilla), the real
  // stock and WAC live on the canonical product, expressed in the base unit.
  let baseQuantity: Prisma.Decimal;
  let baseWac: Prisma.Decimal | null;
  if (conversion) {
    const sharedBalance = sharedBalanceMap.get(conversion.canonicalProductId);
    baseQuantity = sharedBalance?.quantityOnHand ?? ZERO;
    baseWac = sharedBalance?.weightedAverageCost ?? null;
  } else {
    baseQuantity = ownBalance?.quantityOnHand ?? ZERO;
    baseWac = ownBalance?.weightedAverageCost ?? null;
  }

  // Convert base-unit values to the sale unit when a conversion factor applies.
  const saleQuantity = conversion
    ? convertBaseQtyToSaleQty({ baseQuantity, conversionFactor: conversion.conversionFactor })
    : baseQuantity;
  const saleUnitWac = conversion && baseWac
    ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: baseWac, conversionFactor: conversion.conversionFactor })
    : baseWac;

  const pricing = resolveEffectivePricing({
    productId: product.id,
    standardSalePrice: product.standardSalePrice,
    branchPrice: branchSetting?.branchPrice ?? null,
    branchCost: branchSetting?.branchCost ?? null,
    weightedAverageCost: saleUnitWac,
  });

  const dualStock = conversion
    ? formatDualStock({
        baseQuantity,
        conversionFactor: conversion.conversionFactor,
        baseUnit: conversion.baseUnit,
        saleUnit: conversion.saleUnit,
      })
    : null;

  const saleQtyNum = dualStock?.saleQuantity ?? Number(saleQuantity.toDecimalPlaces(4));
  const baseQtyNum = Number(baseQuantity.toDecimalPlaces(4));

  const { branchProductSettings: _settings, inventoryBalances: _balances, ...productData } = product;

  return {
    ...productData,
    ...pricing,
    categoryName: product.category?.name ?? null,
    stockOnHand: saleQtyNum,
    availableStock: saleQtyNum,
    availableBaseStock: baseQtyNum,
    availableSaleStock: saleQtyNum,
    baseUnit: conversion?.baseUnit ?? product.unit,
    saleUnit: conversion?.saleUnit ?? product.unit,
    stockConversion: conversion
      ? {
          stockGroupId: conversion.stockGroupId,
          stockGroupCode: conversion.stockGroupCode,
          stockGroupName: conversion.stockGroupName,
          baseUnit: conversion.baseUnit,
          saleUnit: conversion.saleUnit,
          conversionFactor: conversion.conversionFactor,
          isCanonical: conversion.isCanonical,
        }
      : null,
    sharedStock: dualStock,
  };
}

/**
 * Map a batch of products to branch-scoped catalog rows efficiently.
 * Performs at most 2 extra queries total (stock conversions + shared canonical balances)
 * regardless of how many products are passed in — replacing the previous 3-queries-per-product
 * pattern that caused the slow/failing POS catalog.
 */
async function mapProductsWithBranchInventory<TProduct extends CatalogProductWithBranchPricing>(
  products: TProduct[],
  branchId: string,
) {
  if (products.length === 0) return [];

  const productIds = products.map((product) => product.id);
  const conversionMap = await getProductStockConversionsBatch(prisma, productIds);

  // Collect canonical product ids for shared stock groups whose balances are not the product's own.
  const canonicalIds = new Set<string>();
  for (const conversion of conversionMap.values()) {
    canonicalIds.add(conversion.canonicalProductId);
  }

  const sharedBalanceMap = new Map<string, { quantityOnHand: Prisma.Decimal | null; weightedAverageCost: Prisma.Decimal }>();
  if (canonicalIds.size > 0) {
    const balances = await prisma.inventoryBalance.findMany({
      where: { branchId, productId: { in: [...canonicalIds] } },
      select: { productId: true, quantityOnHand: true, weightedAverageCost: true },
    });
    for (const balance of balances) {
      sharedBalanceMap.set(balance.productId, balance);
    }
  }

  return products.map((product) =>
    buildBranchProductRow(product, branchId, conversionMap.get(product.id) ?? null, sharedBalanceMap),
  );
}

/**
 * Relevance score for catalog search. Higher is better. Used to rank matches BEFORE applying the
 * limit so that an exact barcode/name/SKU match is never dropped just because it sorts later
 * alphabetically (this was a cause of "product exists but is not found" in the POS).
 */
function searchRelevanceScore(
  item: { name?: string | null; sku?: string | null; barcode?: string | null; categoryName?: string | null; category?: { name?: string | null } | null },
  query: string,
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = (item.name ?? "").toLowerCase();
  const sku = (item.sku ?? "").toLowerCase();
  const barcode = (item.barcode ?? "").toLowerCase();
  const categoryName = (item.categoryName ?? item.category?.name ?? "").toLowerCase();

  if (barcode && barcode === q) return 100;
  if (sku && sku === q) return 95;
  if (name === q) return 90;
  if (name.startsWith(q)) return 80;
  if (sku.startsWith(q)) return 72;
  if (barcode.startsWith(q)) return 68;
  if (name.includes(q)) return 55;
  if (sku.includes(q)) return 45;
  if (barcode.includes(q)) return 40;
  if (categoryName.includes(q)) return 20;
  return 0;
}

function rankBySearchRelevance<T extends { name?: string | null }>(items: T[], query: string): T[] {
  return [...items]
    .map((item, index) => ({ item, index, score: searchRelevanceScore(item as never, query) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const nameCompare = (a.item.name ?? "").localeCompare(b.item.name ?? "");
      if (nameCompare !== 0) return nameCompare;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
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

export async function listProducts(params: {
  q?: string;
  isActive?: boolean;
  branchId?: string;
  limit?: number;
  /** When true, products without positive available stock in the branch are excluded (POS mode). */
  inStockOnly?: boolean;
}) {
  const query = params.q?.trim();
  const where: Prisma.ProductWhereInput = {
    isActive: params.isActive,
    ...(query
      ? {
          OR: [
            { sku: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
            { barcode: { contains: query, mode: "insensitive" } },
            { category: { name: { contains: query, mode: "insensitive" } } },
            { category: { code: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const limit = params.limit ?? 1000;
  // When searching or filtering by stock we must over-fetch and then rank/filter so that the
  // most relevant in-stock matches survive the limit (fixes the "exists but not found" bug).
  const needsPostProcessing = Boolean(query) || Boolean(params.inStockOnly);
  const take = needsPostProcessing ? Math.min(Math.max(limit * 10, 200), 1000) : limit;

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
              select: { branchId: true, quantityOnHand: true, weightedAverageCost: true },
            },
          }
        : {}),
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take,
  });

  if (!params.branchId) {
    const ranked = query ? rankBySearchRelevance(products, query) : products;
    return ranked.slice(0, limit);
  }

  let mapped = await mapProductsWithBranchInventory(products, params.branchId);

  // Hide out-of-stock products when requested by the POS.
  if (params.inStockOnly) {
    mapped = mapped.filter((product) => (product.availableStock ?? 0) > 0);
  }

  // Rank by relevance before truncating so exact matches always make the cut.
  if (query) {
    mapped = rankBySearchRelevance(mapped, query);
  }

  return mapped.slice(0, limit);
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

/**
 * Top-selling products to surface in the POS. Per the requirements this returns the products with
 * the highest sales volume:
 *   - in THIS branch only (sales are scoped by saleOrder.branchId),
 *   - over the last 7 days (the current week of activity),
 *   - that currently have stock (out-of-stock items are excluded),
 *   - limited to the top N (default 5).
 * If there aren't enough qualifying best-sellers, it backfills with other in-stock active products.
 */
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
            select: { branchId: true, quantityOnHand: true, weightedAverageCost: true },
          },
        }
      : {}),
  };

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Aggregate sales for the last 7 days, scoped to this branch when provided.
  // Exclude cancelled/returned orders so they don't inflate the ranking.
  const topLines = await prisma.saleOrderLine.groupBy({
    by: ["productId"],
    where: {
      createdAt: { gte: weekAgo },
      ...(params.branchId
        ? {
            saleOrder: {
              branchId: params.branchId,
              status: { notIn: ["CANCELLED", "RETURNED", "DRAFT"] },
            },
          }
        : {}),
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    // Over-fetch: some best-sellers may now be out of stock and get filtered out below.
    take: Math.max(limit * 4, 20),
  });

  const orderedTopIds = topLines.map((line) => line.productId);
  let topProducts: Awaited<ReturnType<typeof mapProductsWithBranchInventory>> = [];

  if (orderedTopIds.length > 0) {
    const products = await prisma.product.findMany({
      where: {
        id: { in: orderedTopIds },
        ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      },
      include,
    });

    const idOrder = new Map(orderedTopIds.map((id, idx) => [id, idx]));
    products.sort((a, b) => (idOrder.get(a.id) ?? 99999) - (idOrder.get(b.id) ?? 99999));

    if (!params.branchId) {
      // No branch context: return raw products (no stock filtering possible).
      return products.slice(0, limit);
    }

    const mapped = await mapProductsWithBranchInventory(products, params.branchId);
    topProducts = mapped.filter((product) => (product.availableStock ?? 0) > 0);
  }

  // Without a branch we cannot filter by stock; just return the top sellers (or active fallback).
  if (!params.branchId) {
    if (topProducts.length > 0) return topProducts.slice(0, limit);
    const fallbackProducts = await prisma.product.findMany({
      where: { isActive: params.isActive },
      include,
      orderBy: { name: "asc" },
      take: limit,
    });
    return fallbackProducts;
  }

  if (topProducts.length >= limit) {
    return topProducts.slice(0, limit);
  }

  // Backfill with other in-stock active products not already included.
  const alreadyIncluded = new Set(topProducts.map((product) => product.id));
  const fallbackCandidates = await prisma.product.findMany({
    where: {
      isActive: params.isActive ?? true,
      id: { notIn: [...alreadyIncluded] },
    },
    include,
    orderBy: { name: "asc" },
    take: Math.max((limit - topProducts.length) * 8, 40),
  });
  const fallbackMapped = (await mapProductsWithBranchInventory(fallbackCandidates, params.branchId))
    .filter((product) => (product.availableStock ?? 0) > 0);

  return [...topProducts, ...fallbackMapped].slice(0, limit);
}
