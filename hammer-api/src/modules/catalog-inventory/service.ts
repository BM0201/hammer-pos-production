import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import type { CatalogInventoryQuery, UpdateBranchProductSettingInput } from "./validators";

const CRITICAL_STOCK_FALLBACK = 1;

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function productWhere(params: Partial<CatalogInventoryQuery>): Prisma.ProductWhereInput {
  return {
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(params.q
      ? {
          OR: [
            { sku: { contains: params.q, mode: "insensitive" } },
            { name: { contains: params.q, mode: "insensitive" } },
            { barcode: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function getCatalogInventoryCenter(params: Partial<CatalogInventoryQuery> = {}) {
  const where = productWhere(params);
  const limit = params.limit ?? 100;
  const [
    branches,
    categories,
    products,
    balances,
    movements,
    transfers,
    reorderAlerts,
    reorderPolicies,
    auditLogs,
  ] = await Promise.all([
    prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        inventoryBalances: {
          where: params.branchId ? { branchId: params.branchId } : undefined,
          include: { branch: { select: { id: true, code: true, name: true } } },
        },
        branchProductSettings: {
          where: params.branchId ? { branchId: params.branchId } : undefined,
          include: { branch: { select: { id: true, code: true, name: true } } },
        },
        reorderPolicies: {
          where: params.branchId ? { branchId: params.branchId } : undefined,
          include: { branch: { select: { id: true, code: true, name: true } } },
        },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      ...(params.productsCursor ? { cursor: { id: params.productsCursor }, skip: 1 } : {}),
      take: limit + 1,
    }),
    prisma.inventoryBalance.findMany({
      where: params.branchId ? { branchId: params.branchId } : undefined,
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true, categoryId: true, standardSalePrice: true, isActive: true } },
      },
      orderBy: [{ product: { name: "asc" } }, { branch: { code: "asc" } }],
      ...(params.balancesCursor ? { cursor: { id: params.balancesCursor }, skip: 1 } : {}),
      take: limit + 1,
    }),
    prisma.inventoryMovement.findMany({
      where: params.branchId ? { branchId: params.branchId } : undefined,
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      ...(params.movementsCursor ? { cursor: { id: params.movementsCursor }, skip: 1 } : {}),
      take: Math.min(limit, 200) + 1,
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
  ]);

  const productsPage = products.slice(0, limit);
  const balancesPage = balances.slice(0, limit);
  const movementsLimit = Math.min(limit, 200);
  const movementsPage = movements.slice(0, movementsLimit);

  const balanceByProduct = new Map<string, typeof balancesPage>();
  for (const balance of balancesPage) {
    const list = balanceByProduct.get(balance.productId) ?? [];
    list.push(balance);
    balanceByProduct.set(balance.productId, list);
  }

  const policyByProductBranch = new Map(reorderPolicies.map((policy) => [`${policy.productId}:${policy.branchId}`, policy]));

  const productRows = productsPage.map((product) => {
    const productBalances = balanceByProduct.get(product.id) ?? [];
    const totalStock = productBalances.reduce((sum, row) => sum + decimalToNumber(row.quantityOnHand), 0);
    const totalValue = productBalances.reduce((sum, row) => sum + decimalToNumber(row.inventoryValue), 0);
    const branchesWithStock = productBalances.filter((row) => decimalToNumber(row.quantityOnHand) > 0).length;
    const weightedCost = productBalances.length > 0
      ? productBalances.reduce((sum, row) => sum + decimalToNumber(row.weightedAverageCost), 0) / productBalances.length
      : 0;
    const critical = productBalances.some((row) => {
      const policy = policyByProductBranch.get(`${product.id}:${row.branchId}`);
      const limit = policy ? decimalToNumber(policy.reorderPoint) : CRITICAL_STOCK_FALLBACK;
      return decimalToNumber(row.quantityOnHand) <= limit;
    });

    return {
      ...product,
      totalStock,
      branchesWithStock,
      inventoryValue: totalValue,
      baseCost: weightedCost,
      basePrice: decimalToNumber(product.standardSalePrice),
      isCriticalStock: critical,
      hasZeroStock: totalStock === 0,
      hasNegativeStock: productBalances.some((row) => decimalToNumber(row.quantityOnHand) < 0),
      hasNoCost: weightedCost <= 0 && product.branchProductSettings.every((setting) => decimalToNumber(setting.branchCost) <= 0),
      hasNoPrice: decimalToNumber(product.standardSalePrice) <= 0 && product.branchProductSettings.every((setting) => decimalToNumber(setting.branchPrice) <= 0),
    };
  });

  const filteredProducts = productRows.filter((product) => {
    if (!params.filter) return true;
    if (params.filter === "LOW_STOCK") return product.isCriticalStock;
    if (params.filter === "ZERO_STOCK") return product.hasZeroStock;
    if (params.filter === "NEGATIVE_STOCK") return product.hasNegativeStock;
    if (params.filter === "NO_COST") return product.hasNoCost;
    if (params.filter === "NO_PRICE") return product.hasNoPrice;
    return true;
  });

  const activeProducts = productRows.filter((product) => product.isActive);
  const kpis = {
    activeProducts: activeProducts.length,
    skusWithoutInventory: productRows.filter((product) => (balanceByProduct.get(product.id) ?? []).length === 0).length,
    criticalStockProducts: productRows.filter((product) => product.isCriticalStock).length,
    zeroStockProducts: productRows.filter((product) => product.hasZeroStock).length,
    totalInventoryValue: balances.reduce((sum, row) => sum + decimalToNumber(row.inventoryValue), 0),
    productsWithoutCost: productRows.filter((product) => product.hasNoCost).length,
    productsWithoutPrice: productRows.filter((product) => product.hasNoPrice).length,
  };

  return {
    branches,
    categories,
    kpis,
    products: filteredProducts,
    balances: balancesPage,
    movements: movementsPage,
    pageInfo: {
      productsNextCursor: products.length > limit ? productsPage.at(-1)?.id ?? null : null,
      balancesNextCursor: balances.length > limit ? balancesPage.at(-1)?.id ?? null : null,
      movementsNextCursor: movements.length > movementsLimit ? movementsPage.at(-1)?.id ?? null : null,
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

export async function upsertBranchProductSetting(input: UpdateBranchProductSettingInput, actorUserId: string) {
  const [branch, product] = await Promise.all([
    prisma.branch.findUnique({ where: { id: input.branchId }, select: { id: true } }),
    prisma.product.findUnique({ where: { id: input.productId }, select: { id: true } }),
  ]);
  if (!branch) throw new Error("INVALID_INPUT: branchId no existe.");
  if (!product) throw new Error("INVALID_INPUT: productId no existe.");

  const data = {
    isAvailable: input.isAvailable,
    minStock: input.minStock === undefined ? undefined : input.minStock === null ? null : new Prisma.Decimal(input.minStock),
    maxStock: input.maxStock === undefined ? undefined : input.maxStock === null ? null : new Prisma.Decimal(input.maxStock),
    reorderPoint: input.reorderPoint === undefined ? undefined : input.reorderPoint === null ? null : new Prisma.Decimal(input.reorderPoint),
    branchCost: input.branchCost === undefined ? undefined : input.branchCost === null ? null : new Prisma.Decimal(input.branchCost),
    branchPrice: input.branchPrice === undefined ? undefined : input.branchPrice === null ? null : new Prisma.Decimal(input.branchPrice),
  };

  const setting = await prisma.branchProductSetting.upsert({
    where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    create: { branchId: input.branchId, productId: input.productId, ...data },
    update: data,
  });

  await logAuditEvent({
    actorUserId,
    branchId: input.branchId,
    module: "catalog-inventory",
    action: "BRANCH_PRODUCT_SETTING_UPSERT",
    entityType: "BranchProductSetting",
    entityId: setting.id,
    metadataJson: { productId: input.productId },
  });

  return setting;
}
