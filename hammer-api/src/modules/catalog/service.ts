import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { generateSkuForProduct, normalizeManualSku } from "@/modules/catalog/sku-generator";
import { mapProductWithEffectivePricing } from "@/modules/catalog/effective-pricing";

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

export async function listProducts(params: { q?: string; isActive?: boolean; branchId?: string }) {
  const where: Prisma.ProductWhereInput = {
    isActive: params.isActive,
    ...(params.q
      ? {
          OR: [
            { sku: { contains: params.q } },
            { name: { contains: params.q } },
            { barcode: { contains: params.q } },
          ],
        }
      : {}),
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
              select: { branchId: true, weightedAverageCost: true },
            },
          }
        : {}),
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 1000,
  });

  return params.branchId ? products.map((product) => mapProductWithEffectivePricing(product, params.branchId)) : products;
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
    select: { name: true },
  });
  const sku = await generateSkuForProduct(prisma, {
    productName: input.productName,
    categoryName: category?.name ?? null,
  });
  return { sku };
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
  const product = await prisma.product.update({
    where: { id: productId },
    data: {
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
    action: "PRODUCT_UPDATE",
    entityType: "Product",
    entityId: product.id,
    metadataJson: { isActive: product.isActive },
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
            select: { branchId: true, weightedAverageCost: true },
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
    return params.branchId ? fallbackProducts.map((product) => mapProductWithEffectivePricing(product, params.branchId)) : fallbackProducts;
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

  return params.branchId ? products.map((product) => mapProductWithEffectivePricing(product, params.branchId)) : products;
}
