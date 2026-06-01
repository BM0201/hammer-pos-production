import { Prisma, PrismaClient } from "@prisma/client";

type PricingClient = PrismaClient | Prisma.TransactionClient;

export type EffectivePricing = {
  productId: string;
  standardSalePrice: Prisma.Decimal;
  branchPrice: Prisma.Decimal | null;
  effectivePrice: Prisma.Decimal;
  branchCost: Prisma.Decimal | null;
  weightedAverageCost: Prisma.Decimal | null;
  effectiveCost: Prisma.Decimal | null;
  priceSource: "BRANCH" | "STANDARD";
  costSource: "BRANCH" | "WAC" | "NONE";
};

type ProductWithOptionalBranchPricing = {
  id: string;
  standardSalePrice: Prisma.Decimal;
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
    select: { id: true, standardSalePrice: true },
  });

  const [branchSetting, inventoryBalance] = await Promise.all([
    txOrPrisma.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      select: { branchPrice: true, branchCost: true },
    }),
    txOrPrisma.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      select: { weightedAverageCost: true },
    }),
  ]);

  return resolveEffectivePricing({
    productId: product.id,
    standardSalePrice: product.standardSalePrice,
    branchPrice: branchSetting?.branchPrice ?? null,
    branchCost: branchSetting?.branchCost ?? null,
    weightedAverageCost: inventoryBalance?.weightedAverageCost ?? null,
  });
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
      branchPrice: branchSetting?.branchPrice ?? null,
      branchCost: branchSetting?.branchCost ?? null,
      weightedAverageCost: inventoryBalance?.weightedAverageCost ?? null,
    }),
  };
}

function resolveEffectivePricing(input: {
  productId: string;
  standardSalePrice: Prisma.Decimal;
  branchPrice: Prisma.Decimal | null;
  branchCost: Prisma.Decimal | null;
  weightedAverageCost: Prisma.Decimal | null;
}): EffectivePricing {
  const effectivePrice = input.branchPrice ?? input.standardSalePrice;
  const effectiveCost = input.branchCost ?? input.weightedAverageCost ?? null;

  return {
    productId: input.productId,
    standardSalePrice: input.standardSalePrice,
    branchPrice: input.branchPrice,
    effectivePrice,
    branchCost: input.branchCost,
    weightedAverageCost: input.weightedAverageCost,
    effectiveCost,
    priceSource: input.branchPrice === null ? "STANDARD" : "BRANCH",
    costSource: input.branchCost !== null ? "BRANCH" : input.weightedAverageCost !== null ? "WAC" : "NONE",
  };
}
