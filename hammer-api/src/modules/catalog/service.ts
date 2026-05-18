import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

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
  name?: string;
  parentId?: string | null;
  isActive?: boolean;
  actorUserId: string;
}) {
  const category = await prisma.category.update({
    where: { id: categoryId },
    data: {
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

export async function listProducts(params: { q?: string; isActive?: boolean }) {
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

  return prisma.product.findMany({
    where,
    include: { category: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 1000,
  });
}

export async function createProduct(input: {
  sku: string;
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
  const product = await prisma.product.create({
    data: {
      sku: input.sku.trim().toUpperCase(),
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



export async function getTopSellingProducts(params: { limit?: number; isActive?: boolean }) {
  const limit = params.limit ?? 5;

  // Get the top-selling product IDs by aggregating sale order lines
  const topLines = await prisma.saleOrderLine.groupBy({
    by: ["productId"],
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: limit,
  });

  if (topLines.length === 0) {
    // Fallback: return first N active products if no sales yet
    return prisma.product.findMany({
      where: { isActive: params.isActive },
      include: { category: true },
      orderBy: { name: "asc" },
      take: limit,
    });
  }

  const productIds = topLines.map((line) => line.productId);
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    },
    include: { category: true },
  });

  // Sort by sales volume (same order as topLines)
  const idOrder = new Map(productIds.map((id, idx) => [id, idx]));
  products.sort((a, b) => (idOrder.get(a.id) ?? 99) - (idOrder.get(b.id) ?? 99));

  return products;
}
