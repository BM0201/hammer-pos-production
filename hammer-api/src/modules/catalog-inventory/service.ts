import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { formatDualStock } from "@/modules/inventory/unit-conversion";
import type { CatalogInventoryQuery, UpdateBranchProductSettingInput, MassDeleteProductsInput } from "./validators";

const CRITICAL_STOCK_FALLBACK = 1;

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number(value);
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
  isPackagePresentation: boolean;
  canonicalProductId: string;
  isCanonical: boolean;
};

function productWhere(params: Partial<CatalogInventoryQuery>): Prisma.ProductWhereInput {
  return {
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(params.q
      ? {
          OR: [
            { sku: { contains: params.q, mode: "insensitive" } },
            { name: { contains: params.q, mode: "insensitive" } },
            { barcode: { contains: params.q, mode: "insensitive" } },
            { category: { name: { contains: params.q, mode: "insensitive" } } },
          ],
        }
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

  /* ── Helper to enrich a product row ── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function enrichProduct(product: any, policyMap: Map<string, any>) {
    const productBalances: any[] = product.inventoryBalances;
    const totalStock = productBalances.reduce((sum: number, row: any) => sum + decimalToNumber(row.quantityOnHand), 0);
    const totalValue = productBalances.reduce((sum: number, row: any) => sum + decimalToNumber(row.inventoryValue), 0);
    const branchesWithStock = productBalances.filter((row: any) => decimalToNumber(row.quantityOnHand) > 0).length;
    const positiveCostBalances = productBalances.filter((row: any) => decimalToNumber(row.weightedAverageCost) > 0);
    const weightedCost = totalStock > 0
      ? totalValue / totalStock
      : positiveCostBalances.length > 0
        ? positiveCostBalances.reduce((sum: number, row: any) => sum + decimalToNumber(row.weightedAverageCost), 0) / positiveCostBalances.length
        : 0;
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
      baseCost: weightedCost,
      basePrice: decimalToNumber(product.standardSalePrice),
      isCriticalStock: critical,
      hasZeroStock: totalStock === 0,
      hasNegativeStock: productBalances.some((row: any) => decimalToNumber(row.quantityOnHand) < 0),
      hasNoCost: weightedCost <= 0 && branchSettings.every((setting: any) => decimalToNumber(setting.branchCost) <= 0),
      hasNoPrice: decimalToNumber(product.standardSalePrice) <= 0 && branchSettings.every((setting: any) => decimalToNumber(setting.branchPrice) <= 0),
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

  filteredProducts = filteredProducts.map((product) => {
    const conversion = conversionByProductId.get(product.id) ?? null;
    const inventoryProductId = conversion?.canonicalProductId ?? product.id;
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
    const aggregateInventoryValue = sharedBalances.reduce((sum, balance) => {
      const qty = balance.quantityOnHand ?? new Prisma.Decimal(0);
      const wac = balance.weightedAverageCost ?? new Prisma.Decimal(0);
      return sum.add(qty.mul(wac));
    }, new Prisma.Decimal(0));
    const displayedBaseQty = selectedShared?.quantityOnHand ?? aggregateBaseQty;
    const displayedWac = selectedShared?.weightedAverageCost ?? (aggregateBaseQty.gt(0) ? aggregateInventoryValue.div(aggregateBaseQty) : null);
    const sharedStock = conversion && displayedBaseQty
        ? formatDualStock({
            baseQuantity: displayedBaseQty,
            conversionFactor: conversion.conversionFactor,
            baseUnit: conversion.baseUnit,
            saleUnit: conversion.saleUnit,
            closedPackageQuantity: selectedShared?.closedPackageQuantity ?? null,
            looseUnitQuantity: selectedShared?.looseUnitQuantity ?? null,
            packageUnit: conversion.packageUnit,
            tracksPackages: conversion.tracksPackages,
          })
        : null;
    return {
      ...product,
      ...(conversion ? {
        totalStock: Number(displayedBaseQty),
        branchesWithStock: sharedBalances.filter((balance) => decimalToNumber(balance.quantityOnHand) > 0).length,
        inventoryValue: Number(aggregateInventoryValue),
        baseCost: displayedWac ? Number(displayedWac) : 0,
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
        isPackagePresentation: conversion.isPackagePresentation,
        isCanonical: conversion.isCanonical,
      } : null,
      sharedStock,
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
  const kpis = {
    activeProducts: allMetricRows.filter((row) => row.isActive).length,
    skusWithoutInventory: allMetricRows.filter((row) => row.isActive && row.inventoryBalances.length === 0).length,
    criticalStockProducts: allMetricRows.filter((row) => row.isActive && row.isCriticalStock).length,
    zeroStockProducts: allMetricRows.filter((row) => row.isActive && row.hasZeroStock).length,
    totalInventoryValue: balances.reduce((sum, row) => sum + decimalToNumber(row.inventoryValue), 0),
    productsWithoutCost: allMetricRows.filter((row) => row.isActive && row.hasNoCost).length,
    productsWithoutPrice: 0,
  };

  const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));

  return {
    branches,
    categories,
    kpis,
    products: filteredProducts,
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

export async function massDeleteAllProducts(input: MassDeleteProductsInput, actorUserId: string) {
  const totalProducts = await prisma.product.count();

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
