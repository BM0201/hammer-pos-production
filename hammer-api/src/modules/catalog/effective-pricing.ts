import { Prisma, PrismaClient } from "@prisma/client";
import { convertBaseUnitCostToSaleUnitCost, resolveInventoryProductForMovement } from "@/modules/inventory/unit-conversion";

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
  /**
   * True when this branch has its OWN operational price configured.
   * When false, the branch is temporarily falling back to the shared standard price
   * and the UI should prompt the user to set a branch-specific price.
   * Per-branch price separation: each branch operates with fully independent prices;
   * the ONLY shared base across branches is the product cost.
   */
  branchPriceConfigured: boolean;
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
    branchPrice: branchSetting?.branchPrice ?? null,
    branchCost: branchSetting?.branchCost ?? null,
    weightedAverageCost: saleUnitWac,
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

export function resolveEffectivePricing(input: {
  productId: string;
  standardSalePrice: Prisma.Decimal;
  branchPrice: Prisma.Decimal | null;
  branchCost: Prisma.Decimal | null;
  weightedAverageCost: Prisma.Decimal | null;
}): EffectivePricing {
  // Per-branch price separation: the branch price is the ONLY operational sale price for the branch.
  // The standard price is just a shared fallback used until the branch configures its own price.
  const branchPriceConfigured = input.branchPrice !== null;
  const effectivePrice = input.branchPrice ?? input.standardSalePrice;
  // Cost is the only value shared across branches (product base cost / WAC).
  const effectiveCost = input.branchCost ?? input.weightedAverageCost ?? null;

  return {
    productId: input.productId,
    standardSalePrice: input.standardSalePrice,
    branchPrice: input.branchPrice,
    effectivePrice,
    branchCost: input.branchCost,
    weightedAverageCost: input.weightedAverageCost,
    effectiveCost,
    priceSource: branchPriceConfigured ? "BRANCH" : "STANDARD",
    costSource: input.branchCost !== null ? "BRANCH" : input.weightedAverageCost !== null ? "WAC" : "NONE",
    branchPriceConfigured,
  };
}
