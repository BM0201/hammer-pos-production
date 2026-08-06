import { Prisma, PrismaClient } from "@prisma/client";
import { convertBaseUnitCostToSaleUnitCost, resolveInventoryProductForMovement, getProductStockConversionsBatch } from "@/modules/inventory/unit-conversion";

type PricingClient = PrismaClient | Prisma.TransactionClient;

export type EffectivePricing = {
  productId: string;
  standardSalePrice: Prisma.Decimal;
  branchPrice: Prisma.Decimal | null;
  effectivePrice: Prisma.Decimal | null;
  branchCost: Prisma.Decimal | null;
  weightedAverageCost: Prisma.Decimal | null;
  globalCost: Prisma.Decimal | null;
  averageCost: Prisma.Decimal | null;
  lastPurchaseCost: Prisma.Decimal | null;
  effectiveCost: Prisma.Decimal | null;
  priceSource: "BRANCH" | "MISSING";
  costSource: "BRANCH" | "GLOBAL_AVERAGE" | "GLOBAL" | "LAST_PURCHASE" | "WAC_ESTIMATE" | "NONE";
};

type ProductWithOptionalBranchPricing = {
  id: string;
  standardSalePrice: Prisma.Decimal;
  globalCost?: Prisma.Decimal | null;
  averageCost?: Prisma.Decimal | null;
  lastPurchaseCost?: Prisma.Decimal | null;
  branchProductSettings?: Array<{
    branchId: string;
    branchPrice: Prisma.Decimal | null;
    branchCost: Prisma.Decimal | null;
  }>;
  inventoryBalances?: Array<{
    branchId: string;
    weightedAverageCost: Prisma.Decimal;
  }>;
};

export async function getEffectiveProductPricing(
  txOrPrisma: PricingClient,
  input: { branchId: string; productId: string },
): Promise<EffectivePricing> {
  const product = await txOrPrisma.product.findUniqueOrThrow({
    where: { id: input.productId },
    select: { id: true, standardSalePrice: true, globalCost: true, averageCost: true, lastPurchaseCost: true },
  });

  const stockResolution = await resolveInventoryProductForMovement(txOrPrisma, input.productId);
  const [branchSetting, inventoryBalance] = await Promise.all([
    txOrPrisma.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      select: { branchPrice: true, branchCost: true },
    }),
    txOrPrisma.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: stockResolution.inventoryProductId } },
      select: { weightedAverageCost: true },
    }),
  ]);
  const saleUnitWac = inventoryBalance?.weightedAverageCost && stockResolution.conversion
    ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: inventoryBalance.weightedAverageCost, conversionFactor: stockResolution.conversion.conversionFactor })
    : inventoryBalance?.weightedAverageCost ?? null;

  return resolveEffectivePricing({
    productId: product.id,
    standardSalePrice: product.standardSalePrice,
    globalCost: product.globalCost,
    averageCost: product.averageCost,
    lastPurchaseCost: product.lastPurchaseCost,
    branchPrice: branchSetting?.branchPrice ?? null,
    branchCost: branchSetting?.branchCost ?? null,
    weightedAverageCost: saleUnitWac,
  });
}

/**
 * Batch version of getEffectiveProductPricing — resolves effective pricing for
 * many (branchId, productId) pairs in a fixed small number of queries instead
 * of ~4 queries per pair. Used by hot loops (Brain detectors, replenishment,
 * commercial-intelligence) that previously called getEffectiveProductPricing
 * once per item, turning O(n) sequential round trips into O(1).
 */
export async function getEffectiveProductPricingBatch(
  txOrPrisma: PricingClient,
  items: Array<{ branchId: string; productId: string }>,
): Promise<Map<string, EffectivePricing>> {
  const result = new Map<string, EffectivePricing>();
  if (items.length === 0) return result;

  const productIds = [...new Set(items.map((item) => item.productId))];
  const branchIds = [...new Set(items.map((item) => item.branchId))];

  const [products, conversionByProductId, branchSettings] = await Promise.all([
    txOrPrisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, standardSalePrice: true, globalCost: true, averageCost: true, lastPurchaseCost: true },
    }),
    getProductStockConversionsBatch(txOrPrisma, productIds),
    txOrPrisma.branchProductSetting.findMany({
      where: { productId: { in: productIds }, branchId: { in: branchIds } },
      select: { branchId: true, productId: true, branchPrice: true, branchCost: true },
    }),
  ]);

  const productById = new Map(products.map((product) => [product.id, product]));
  const settingByKey = new Map(branchSettings.map((setting) => [`${setting.branchId}:${setting.productId}`, setting]));

  const inventoryProductIdByProductId = new Map(
    productIds.map((productId) => [productId, conversionByProductId.get(productId)?.canonicalProductId ?? productId]),
  );
  const inventoryProductIds = [...new Set(inventoryProductIdByProductId.values())];

  const balances = await txOrPrisma.inventoryBalance.findMany({
    where: { productId: { in: inventoryProductIds }, branchId: { in: branchIds } },
    select: { branchId: true, productId: true, weightedAverageCost: true },
  });
  const balanceByKey = new Map(balances.map((balance) => [`${balance.branchId}:${balance.productId}`, balance]));

  for (const { branchId, productId } of items) {
    const key = `${branchId}:${productId}`;
    if (result.has(key)) continue;
    const product = productById.get(productId);
    if (!product) continue;

    const conversion = conversionByProductId.get(productId) ?? null;
    const inventoryProductId = inventoryProductIdByProductId.get(productId) ?? productId;
    const balance = balanceByKey.get(`${branchId}:${inventoryProductId}`);
    const saleUnitWac = balance?.weightedAverageCost && conversion
      ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: balance.weightedAverageCost, conversionFactor: conversion.conversionFactor })
      : balance?.weightedAverageCost ?? null;
    const setting = settingByKey.get(key);

    result.set(key, resolveEffectivePricing({
      productId: product.id,
      standardSalePrice: product.standardSalePrice,
      globalCost: product.globalCost,
      averageCost: product.averageCost,
      lastPurchaseCost: product.lastPurchaseCost,
      branchPrice: setting?.branchPrice ?? null,
      branchCost: setting?.branchCost ?? null,
      weightedAverageCost: saleUnitWac,
    }));
  }

  return result;
}

export function mapProductWithEffectivePricing<TProduct extends ProductWithOptionalBranchPricing>(
  product: TProduct,
  branchId?: string,
): TProduct | (Omit<TProduct, "branchProductSettings" | "inventoryBalances"> & EffectivePricing) {
  if (!branchId) return product;

  const { branchProductSettings: _settings, inventoryBalances: _balances, ...productData } = product;
  const branchSetting = product.branchProductSettings?.find((setting) => setting.branchId === branchId);
  const inventoryBalance = product.inventoryBalances?.find((balance) => balance.branchId === branchId);

  return {
    ...productData,
    ...resolveEffectivePricing({
      productId: product.id,
      standardSalePrice: product.standardSalePrice,
      globalCost: product.globalCost ?? null,
      averageCost: product.averageCost ?? null,
      lastPurchaseCost: product.lastPurchaseCost ?? null,
      branchPrice: branchSetting?.branchPrice ?? null,
      branchCost: branchSetting?.branchCost ?? null,
      weightedAverageCost: inventoryBalance?.weightedAverageCost ?? null,
    }),
  };
}

function resolveEffectivePricing(input: {
  productId: string;
  standardSalePrice: Prisma.Decimal;
  globalCost?: Prisma.Decimal | null;
  averageCost?: Prisma.Decimal | null;
  lastPurchaseCost?: Prisma.Decimal | null;
  branchPrice: Prisma.Decimal | null;
  branchCost: Prisma.Decimal | null;
  weightedAverageCost: Prisma.Decimal | null;
}): EffectivePricing {
  const effectivePrice = input.branchPrice;

  // Prioridad de costo: branchCost > averageCost > globalCost > lastPurchaseCost > WAC > null.
  // branchCost permite que cada sucursal registre su propio costo de adquisición
  // (p.ej. proveedor local diferente), lo que produce snapshots de margen correctos.
  const effectiveCost = input.branchCost
    ?? input.averageCost
    ?? input.globalCost
    ?? input.lastPurchaseCost
    ?? input.weightedAverageCost
    ?? null;

  const costSource: EffectivePricing["costSource"] = input.branchCost !== null && input.branchCost !== undefined
    ? "BRANCH"
    : input.averageCost !== null && input.averageCost !== undefined
      ? "GLOBAL_AVERAGE"
      : input.globalCost !== null && input.globalCost !== undefined
        ? "GLOBAL"
        : input.lastPurchaseCost !== null && input.lastPurchaseCost !== undefined
          ? "LAST_PURCHASE"
          : input.weightedAverageCost !== null
            ? "WAC_ESTIMATE"
            : "NONE";

  return {
    productId: input.productId,
    standardSalePrice: input.standardSalePrice,
    branchPrice: input.branchPrice,
    effectivePrice,
    branchCost: input.branchCost,
    weightedAverageCost: input.weightedAverageCost,
    globalCost: input.globalCost ?? null,
    averageCost: input.averageCost ?? null,
    lastPurchaseCost: input.lastPurchaseCost ?? null,
    effectiveCost,
    priceSource: input.branchPrice === null ? "MISSING" : "BRANCH",
    costSource,
  };
}

export { resolveEffectivePricing as resolveEffectivePricingFromParts };
