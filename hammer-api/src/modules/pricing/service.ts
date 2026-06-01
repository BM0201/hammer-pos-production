import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { calculatePricingSuggestion, calculateSuggestedPrice, type PricingSuggestionInput, type SuggestedPriceResult } from "./calculator";
import type { ApplyPricingInput, CreateExpenseInput, UpdateExpenseInput, UpsertPricingConfigInput } from "./validators";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import { buildCommercialIntelligenceForProduct } from "@/modules/pricing/commercial-intelligence";

/* ══════════════════════════════════════════════════════
 *  OPERATING EXPENSES
 * ══════════════════════════════════════════════════════ */

export async function createOperatingExpense(
  input: CreateExpenseInput,
  actorUserId: string,
) {
  const expense = await prisma.operatingExpense.create({
    data: {
      branchId: input.branchId,
      category: input.category as any,
      description: input.description,
      amount: new Prisma.Decimal(input.amount),
      effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      createdByUserId: actorUserId,
    },
  });

  await logAuditEvent({
    actorUserId,
    branchId: input.branchId,
    module: "expenses",
    action: "EXPENSE_CREATED",
    entityType: "OperatingExpense",
    entityId: expense.id,
    metadataJson: {
      category: input.category,
      description: input.description,
      amount: input.amount,
    },
  });

  return expense;
}

export async function updateOperatingExpense(
  id: string,
  input: UpdateExpenseInput,
  actorUserId: string,
) {
  const existing = await prisma.operatingExpense.findUniqueOrThrow({ where: { id } });

  const data: Prisma.OperatingExpenseUpdateInput = {};
  if (input.category !== undefined) data.category = input.category as any;
  if (input.description !== undefined) data.description = input.description;
  if (input.amount !== undefined) data.amount = new Prisma.Decimal(input.amount);
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.effectiveFrom !== undefined) data.effectiveFrom = new Date(input.effectiveFrom);
  if (input.effectiveTo !== undefined) data.effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;

  const updated = await prisma.operatingExpense.update({ where: { id }, data });

  await logAuditEvent({
    actorUserId,
    branchId: existing.branchId,
    module: "expenses",
    action: "EXPENSE_UPDATED",
    entityType: "OperatingExpense",
    entityId: id,
    metadataJson: { changes: input },
  });

  return updated;
}

export async function deleteOperatingExpense(id: string, actorUserId: string) {
  const existing = await prisma.operatingExpense.findUniqueOrThrow({ where: { id } });

  // Soft delete
  await prisma.operatingExpense.update({
    where: { id },
    data: { isActive: false },
  });

  await logAuditEvent({
    actorUserId,
    branchId: existing.branchId,
    module: "expenses",
    action: "EXPENSE_DELETED",
    entityType: "OperatingExpense",
    entityId: id,
    metadataJson: { category: existing.category, amount: existing.amount.toString() },
  });
}

export async function listExpensesByBranch(branchId: string) {
  return prisma.operatingExpense.findMany({
    where: { branchId, isActive: true },
    include: { branch: { select: { id: true, code: true, name: true } } },
    orderBy: [{ category: "asc" }, { description: "asc" }],
  });
}

export async function getMonthlyExpensesByBranch(branchId: string): Promise<Prisma.Decimal> {
  const expenses = await prisma.operatingExpense.findMany({
    where: {
      branchId,
      isActive: true,
      effectiveFrom: { lte: new Date() },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gte: new Date() } },
      ],
    },
    select: { amount: true },
  });

  return expenses.reduce(
    (sum, e) => sum.add(e.amount),
    new Prisma.Decimal(0),
  );
}

export async function getExpenseSummaryByBranch(branchId: string) {
  const expenses = await listExpensesByBranch(branchId);

  const byCategory: Record<string, { total: number; count: number; items: typeof expenses }> = {};
  let grandTotal = 0;

  for (const exp of expenses) {
    const cat = exp.category;
    if (!byCategory[cat]) byCategory[cat] = { total: 0, count: 0, items: [] };
    const amount = Number(exp.amount);
    byCategory[cat].total += amount;
    byCategory[cat].count += 1;
    byCategory[cat].items.push(exp);
    grandTotal += amount;
  }

  return { byCategory, grandTotal, totalExpenses: expenses.length };
}

/* ══════════════════════════════════════════════════════
 *  PRICING CONFIGURATION
 * ══════════════════════════════════════════════════════ */

export async function upsertPricingConfig(
  input: UpsertPricingConfigInput,
  actorUserId: string,
) {
  const config = await prisma.pricingConfig.upsert({
    where: { branchId: input.branchId },
    create: {
      branchId: input.branchId,
      desiredMarginPercent: new Prisma.Decimal(input.desiredMarginPercent),
      prorationMethod: (input.prorationMethod ?? "BY_QUANTITY") as any,
      estimatedMonthlyUnits: new Prisma.Decimal(input.estimatedMonthlyUnits),
      updatedByUserId: actorUserId,
    },
    update: {
      desiredMarginPercent: new Prisma.Decimal(input.desiredMarginPercent),
      ...(input.prorationMethod ? { prorationMethod: input.prorationMethod as any } : {}),
      estimatedMonthlyUnits: new Prisma.Decimal(input.estimatedMonthlyUnits),
      updatedByUserId: actorUserId,
    },
  });

  await logAuditEvent({
    actorUserId,
    branchId: input.branchId,
    module: "pricing",
    action: "PRICING_CONFIG_UPDATED",
    entityType: "PricingConfig",
    entityId: config.id,
    metadataJson: {
      desiredMarginPercent: input.desiredMarginPercent,
      estimatedMonthlyUnits: input.estimatedMonthlyUnits,
      prorationMethod: input.prorationMethod,
    },
  });

  return config;
}

export async function getPricingConfig(branchId: string) {
  return prisma.pricingConfig.findUnique({
    where: { branchId },
    include: { branch: { select: { id: true, code: true, name: true } } },
  });
}

export async function listAllPricingConfigs() {
  return prisma.pricingConfig.findMany({
    include: { branch: { select: { id: true, code: true, name: true } } },
    orderBy: { branch: { name: "asc" } },
  });
}

/* ══════════════════════════════════════════════════════
 *  SUGGESTED PRICE CALCULATION
 * ══════════════════════════════════════════════════════ */

export async function calculateSuggestedPriceForProduct(params: {
  branchId: string;
  purchaseCostPerUnit: number;
  productId?: string;
  actorUserId?: string;
}): Promise<SuggestedPriceResult & { configExists: boolean }> {
  const config = await getPricingConfig(params.branchId);

  // If no config, use defaults
  const marginPercent = config
    ? config.desiredMarginPercent
    : new Prisma.Decimal(30);
  const estimatedUnits = config
    ? config.estimatedMonthlyUnits
    : new Prisma.Decimal(1000);

  const totalMonthlyExpenses = await getMonthlyExpensesByBranch(params.branchId);

  const result = calculateSuggestedPrice({
    purchaseCostPerUnit: new Prisma.Decimal(params.purchaseCostPerUnit),
    totalMonthlyExpenses,
    estimatedMonthlyUnits: estimatedUnits,
    desiredMarginPercent: marginPercent,
  });

  // Save to history if productId is provided
  if (params.productId) {
    await prisma.productPricing.create({
      data: {
        productId: params.productId,
        branchId: params.branchId,
        purchaseCost: result.purchaseCost,
        operatingExpensePerUnit: result.operatingExpensePerUnit,
        totalCostPerUnit: result.totalCostPerUnit,
        marginPercent: result.marginPercent,
        suggestedPrice: result.suggestedPrice,
        totalMonthlyExpenses: result.totalMonthlyExpenses,
        estimatedMonthlyUnits: result.estimatedMonthlyUnits,
        calculatedByUserId: params.actorUserId,
      },
    });
  }

  return { ...result, configExists: !!config };
}

export async function calculatePricingSuggestionForBranch(params: PricingSuggestionInput & {
  branchId?: string;
  productId?: string;
  actorUserId?: string;
  useCategoryPolicy?: boolean;
  forcePolicyValues?: boolean;
  useCommercialIntelligence?: boolean;
  forceCommercialValues?: boolean;
}) {
  let configExists = false;
  let monthlyOperatingExpenses = params.monthlyOperatingExpenses;
  let estimatedMonthlyUnits = params.estimatedMonthlyUnits;
  let marginPercent = params.marginPercent;
  let prorateMethod = params.prorateMethod;
  let policyApplied = false;
  let policySource: "CATEGORY" | "VIRTUAL_DEFAULT" | undefined;
  let categoryPolicySnapshot: Awaited<ReturnType<typeof resolvePolicyForProduct>>["categoryPolicy"] | undefined;
  let commercialIntelligenceApplied = false;
  let commercialIntelligenceSnapshot: Awaited<ReturnType<typeof buildCommercialIntelligenceForProduct>> | undefined;

  if (params.useCategoryPolicy && params.branchId && params.productId) {
    const resolved = await resolvePolicyForProduct({ branchId: params.branchId, productId: params.productId });
    categoryPolicySnapshot = resolved.categoryPolicy;
    policyApplied = true;
    policySource = categoryPolicySnapshot.isVirtualDefault ? "VIRTUAL_DEFAULT" : "CATEGORY";
    const force = params.forcePolicyValues === true;
    if (force || marginPercent === undefined) marginPercent = categoryPolicySnapshot.targetMarginPercent;
    if (force || params.minProfitAmount === undefined) params.minProfitAmount = categoryPolicySnapshot.minProfitAmount;
    if (force || monthlyOperatingExpenses === undefined) monthlyOperatingExpenses = categoryPolicySnapshot.monthlyExpenseAllocation;
    if (force || estimatedMonthlyUnits === undefined) estimatedMonthlyUnits = categoryPolicySnapshot.estimatedMonthlyUnits;
    if (force || params.estimatedMonthlySalesValue === undefined) params.estimatedMonthlySalesValue = categoryPolicySnapshot.estimatedMonthlySalesValue ?? undefined;
    if (force || params.roundingRule === undefined) params.roundingRule = categoryPolicySnapshot.roundingRule as any;
  }

  if (params.branchId) {
    const config = await getPricingConfig(params.branchId);
    configExists = Boolean(config);
    monthlyOperatingExpenses ??= await getMonthlyExpensesByBranch(params.branchId);
    estimatedMonthlyUnits ??= config?.estimatedMonthlyUnits ?? new Prisma.Decimal(1000);
    marginPercent ??= config?.desiredMarginPercent ?? new Prisma.Decimal(30);
    prorateMethod ??= (config?.prorationMethod as "BY_QUANTITY" | "BY_VALUE" | undefined) ?? "BY_QUANTITY";
  }

  if (params.useCommercialIntelligence && params.branchId && params.productId) {
    commercialIntelligenceSnapshot = await buildCommercialIntelligenceForProduct({
      branchId: params.branchId,
      productId: params.productId,
    });
    commercialIntelligenceApplied = true;
    const force = params.forceCommercialValues === true;
    if (force || params.marginPercent === undefined) marginPercent = commercialIntelligenceSnapshot.recommendedMarginPercent;
    if (force || params.minProfitAmount === undefined) params.minProfitAmount = commercialIntelligenceSnapshot.recommendedMinProfitAmount;
  }

  const result = calculatePricingSuggestion({
    ...params,
    monthlyOperatingExpenses: monthlyOperatingExpenses ?? 0,
    estimatedMonthlyUnits: estimatedMonthlyUnits ?? 1,
    marginPercent,
    prorateMethod,
  });

  if (params.branchId && params.productId) {
    await prisma.productPricing.create({
      data: {
        productId: params.productId,
        branchId: params.branchId,
        purchaseCost: result.baseCost,
        operatingExpensePerUnit: result.operatingExpensePerUnit,
        totalCostPerUnit: result.totalInternalCost,
        marginPercent: result.marginPercent,
        suggestedPrice: result.suggestedPrice,
        totalMonthlyExpenses: result.monthlyOperatingExpenses,
        estimatedMonthlyUnits: result.estimatedMonthlyUnits,
        calculatedByUserId: params.actorUserId,
      },
    });
  }

  return {
    ...result,
    configExists,
    policyApplied,
    policySource,
    categoryPolicySnapshot,
    commercialIntelligenceApplied,
    commercialIntelligenceSnapshot,
  };
}

export async function getProductPricingHistory(productId: string, branchId: string, limit = 20) {
  return prisma.productPricing.findMany({
    where: { productId, branchId },
    orderBy: { calculatedAt: "desc" },
    take: limit,
  });
}

export async function getProductPricingContext(input: { productId: string; branchId: string }) {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: input.productId },
    select: { id: true, sku: true, name: true, categoryId: true, category: { select: { name: true } } },
  });
  const pricing = await getEffectiveProductPricing(prisma, input);
  const policy = await resolvePolicyForProduct(input);
  const commercialIntelligence = await buildCommercialIntelligenceForProduct(input);

  return {
    productId: product.id,
    branchId: input.branchId,
    sku: product.sku,
    name: product.name,
    categoryId: product.categoryId,
    categoryName: product.category.name,
    standardSalePrice: Number(pricing.standardSalePrice),
    branchPrice: pricing.branchPrice === null ? null : Number(pricing.branchPrice),
    effectivePrice: Number(pricing.effectivePrice),
    priceSource: pricing.priceSource,
    branchCost: pricing.branchCost === null ? null : Number(pricing.branchCost),
    weightedAverageCost: pricing.weightedAverageCost === null ? null : Number(pricing.weightedAverageCost),
    effectiveCost: pricing.effectiveCost === null ? null : Number(pricing.effectiveCost),
    costSource: pricing.costSource,
    categoryPolicy: policy.categoryPolicy,
    commercialIntelligence,
  };
}

export async function applySuggestedPrice(input: ApplyPricingInput & { actorUserId: string }) {
  const warnings: string[] = [];
  if (input.maxPrice !== undefined && input.maxPrice !== null && input.suggestedPrice > input.maxPrice) {
    warnings.push("El precio sugerido supera el precio maximo de mercado indicado.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: input.productId },
      select: { id: true, standardSalePrice: true },
    });

    let previousPrice: Prisma.Decimal | null = null;
    let priceSourceAfter: "BRANCH" | "STANDARD";
    const newPrice = new Prisma.Decimal(input.suggestedPrice);

    if (input.applyScope === "BRANCH") {
      const branchId = input.branchId!;
      const existing = await tx.branchProductSetting.findUnique({
        where: { branchId_productId: { branchId, productId: input.productId } },
        select: { branchPrice: true },
      });
      previousPrice = existing?.branchPrice ?? null;
      await tx.branchProductSetting.upsert({
        where: { branchId_productId: { branchId, productId: input.productId } },
        create: { branchId, productId: input.productId, branchPrice: newPrice },
        update: { branchPrice: newPrice },
      });
      priceSourceAfter = "BRANCH";
    } else {
      previousPrice = product.standardSalePrice;
      await tx.product.update({
        where: { id: input.productId },
        data: { standardSalePrice: newPrice },
      });
      priceSourceAfter = "STANDARD";
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: input.applyScope === "BRANCH" ? input.branchId : undefined,
        module: "pricing",
        action: "PRICE_APPLIED",
        entityType: "Product",
        entityId: input.productId,
        metadataJson: {
          productId: input.productId,
          branchId: input.branchId ?? null,
          applyScope: input.applyScope,
          previousPrice: previousPrice?.toString() ?? null,
          newPrice: newPrice.toString(),
          minPrice: input.minPrice ?? null,
          maxPrice: input.maxPrice ?? null,
          totalInternalCost: input.totalInternalCost ?? null,
          effectiveCost: input.effectiveCost ?? null,
          marginPercent: input.marginPercent ?? null,
          grossMarginPercent: input.grossMarginPercent ?? null,
          markupPercent: input.markupPercent ?? null,
          roundingRule: input.roundingRule ?? null,
          reason: input.reason ?? null,
          warnings,
          calculationSnapshot: input.calculationSnapshot ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      productId: input.productId,
      branchId: input.branchId,
      applyScope: input.applyScope,
      previousPrice: previousPrice === null ? null : Number(previousPrice),
      newPrice: Number(newPrice),
      priceSourceAfter,
      warnings,
    };
  });

  return result;
}
