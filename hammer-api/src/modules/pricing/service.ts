import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { calculateSuggestedPrice, type SuggestedPriceResult } from "./calculator";
import type { CreateExpenseInput, UpdateExpenseInput, UpsertPricingConfigInput } from "./validators";

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

export async function getProductPricingHistory(productId: string, branchId: string, limit = 20) {
  return prisma.productPricing.findMany({
    where: { productId, branchId },
    orderBy: { calculatedAt: "desc" },
    take: limit,
  });
}
