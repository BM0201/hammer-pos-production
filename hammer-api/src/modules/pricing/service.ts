import { CashMovementType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { calculatePricingSuggestion, calculateSuggestedPrice, type PricingSuggestionInput, type SuggestedPriceResult } from "./calculator";
import type { ApplyPricingInput, CreateExpenseInput, UpdateExpenseInput, UpsertPricingConfigInput } from "./validators";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import { buildCommercialIntelligenceForProduct } from "@/modules/pricing/commercial-intelligence";
import { getActiveCashSession, syncCashSessionSnapshotTx } from "@/modules/cash-session/service";

/* ══════════════════════════════════════════════════════
 *  OPERATING EXPENSES
 * ══════════════════════════════════════════════════════ */

export type CreateOperatingExpenseOptions = {
  /**
   * Cuando es true, además de registrar el gasto se genera automáticamente un
   * CashMovement (EXPENSE_OUT) en la caja abierta de la sucursal y se enlaza al
   * gasto. Así el gasto cuenta como "gasto real pagado" y mueve el % ejecutado
   * del presupuesto (antes el gasto solo alimentaba el presupuesto y jamás se
   * reflejaba como egreso real). Si no hay caja abierta, el gasto se crea igual
   * pero sin egreso de caja (cashApplied=false, reason=NO_OPEN_SESSION).
   */
  registerCashMovement?: boolean;
};

export type CreateOperatingExpenseResult = Prisma.OperatingExpenseGetPayload<{}> & {
  cashApplied: boolean;
  cashReason?: string;
};

export async function createOperatingExpense(
  input: CreateExpenseInput,
  actorUserId: string,
  options: CreateOperatingExpenseOptions = {},
): Promise<CreateOperatingExpenseResult> {
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
  const effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;

  const baseData = {
    branchId: input.branchId,
    category: input.category as any,
    description: input.description,
    amount: new Prisma.Decimal(input.amount),
    effectiveFrom,
    effectiveTo,
    createdByUserId: actorUserId,
  };

  // Camino simple (presupuesto): sin egreso de caja.
  if (!options.registerCashMovement) {
    const expense = await prisma.operatingExpense.create({ data: baseData });
    await auditExpenseCreated(actorUserId, input, expense.id, false);
    return { ...expense, cashApplied: false };
  }

  // Camino con egreso real: intenta descontar de la caja abierta de la sucursal.
  const activeSession = await getActiveCashSession({ branchId: input.branchId });
  if (!activeSession) {
    const expense = await prisma.operatingExpense.create({ data: baseData });
    await auditExpenseCreated(actorUserId, input, expense.id, false);
    return { ...expense, cashApplied: false, cashReason: "NO_OPEN_SESSION" };
  }

  const result = await prisma.$transaction(async (tx) => {
    const movement = await tx.cashMovement.create({
      data: {
        cashSessionId: activeSession.id,
        type: CashMovementType.EXPENSE_OUT,
        amount: new Prisma.Decimal(input.amount),
        reason: input.description,
        createdByUserId: actorUserId,
      },
    });

    const expense = await tx.operatingExpense.create({
      data: { ...baseData, cashMovementId: movement.id },
    });

    // Recalcula el efectivo esperado de la sesión tras el egreso.
    await syncCashSessionSnapshotTx(tx, activeSession.id);

    return { expense, movementId: movement.id };
  });

  await auditExpenseCreated(actorUserId, input, result.expense.id, true, result.movementId);
  return { ...result.expense, cashApplied: true };
}

async function auditExpenseCreated(
  actorUserId: string,
  input: CreateExpenseInput,
  expenseId: string,
  cashApplied: boolean,
  cashMovementId?: string,
) {
  await logAuditEvent({
    actorUserId,
    branchId: input.branchId,
    module: "expenses",
    action: "EXPENSE_CREATED",
    entityType: "OperatingExpense",
    entityId: expenseId,
    metadataJson: {
      category: input.category,
      description: input.description,
      amount: input.amount,
      cashApplied,
      ...(cashMovementId ? { cashMovementId } : {}),
    },
  });
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

export async function listExpensesByBranch(
  branchId: string,
  opts?: { effectiveFromGte?: Date; effectiveFromLt?: Date },
) {
  return prisma.operatingExpense.findMany({
    where: {
      branchId,
      isActive: true,
      ...(opts?.effectiveFromGte || opts?.effectiveFromLt
        ? {
            effectiveFrom: {
              ...(opts.effectiveFromGte ? { gte: opts.effectiveFromGte } : {}),
              ...(opts.effectiveFromLt ? { lt: opts.effectiveFromLt } : {}),
            },
          }
        : {}),
    },
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

export async function getExpenseSummaryByBranch(branchId: string, db: typeof prisma = prisma) {
  // Mismo filtro de vigencia que getMonthlyExpensesByBranch: sin esto, un gasto
  // (en especial la sincronización automática de planilla, que crea un registro
  // nuevo por mes y nunca desactiva los anteriores) se sigue sumando para siempre
  // aunque su período ya haya terminado.
  const now = new Date();
  const expenses = await db.operatingExpense.findMany({
    where: {
      branchId,
      isActive: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    include: { branch: { select: { id: true, code: true, name: true } } },
    orderBy: [{ category: "asc" }, { description: "asc" }],
  });

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

/**
 * Resumen consolidado de gastos operativos de TODAS las sucursales activas
 * (vista "Todas las sucursales" del manager — solo lectura, para análisis).
 * Un solo groupBy por sucursal+categoría, sin N+1.
 */
export async function getExpenseSummaryAllBranches(db: typeof prisma = prisma) {
  const now = new Date();
  const [grouped, branches] = await Promise.all([
    db.operatingExpense.groupBy({
      by: ["branchId", "category"],
      where: {
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      _sum: { amount: true },
    }),
    db.branch.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const totalsByBranch = new Map<string, { byCategory: Record<string, number>; total: number }>();
  const totalsByCategory = new Map<string, number>();
  let grandTotal = 0;

  for (const row of grouped) {
    const amount = Number(row._sum.amount ?? 0);
    let entry = totalsByBranch.get(row.branchId);
    if (!entry) {
      entry = { byCategory: {}, total: 0 };
      totalsByBranch.set(row.branchId, entry);
    }
    entry.byCategory[row.category] = Math.round(((entry.byCategory[row.category] ?? 0) + amount) * 100) / 100;
    entry.total += amount;
    totalsByCategory.set(row.category, (totalsByCategory.get(row.category) ?? 0) + amount);
    grandTotal += amount;
  }

  const topCategory =
    [...totalsByCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const byBranch = branches
    .map((b) => {
      const entry = totalsByBranch.get(b.id);
      return {
        branchId: b.id,
        branchCode: b.code,
        branchName: b.name,
        byCategory: entry?.byCategory ?? {},
        total: Math.round((entry?.total ?? 0) * 100) / 100,
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    grandTotal: Math.round(grandTotal * 100) / 100,
    branchesWithExpenses: byBranch.filter((b) => b.total > 0).length,
    totalBranches: branches.length,
    topCategory,
    byBranch,
  };
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
  let expenseAllocationScope = params.expenseAllocationScope;
  let branchMonthlyUnits = params.branchMonthlyUnits;
  let categoryMonthlyUnits = params.categoryMonthlyUnits;
  let productMonthlyUnits = params.productMonthlyUnits;
  const serviceWarnings: string[] = [];
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
    if (force || expenseAllocationScope === undefined) expenseAllocationScope = "CATEGORY";
    if (force || marginPercent === undefined) marginPercent = categoryPolicySnapshot.targetMarginPercent;
    if (force || params.minProfitAmount === undefined) params.minProfitAmount = categoryPolicySnapshot.minProfitAmount;
    if (force || monthlyOperatingExpenses === undefined) monthlyOperatingExpenses = categoryPolicySnapshot.monthlyExpenseAllocation;
    if (force || categoryMonthlyUnits === undefined) categoryMonthlyUnits = categoryPolicySnapshot.estimatedMonthlyUnits;
    if (force || estimatedMonthlyUnits === undefined) estimatedMonthlyUnits = categoryPolicySnapshot.estimatedMonthlyUnits;
    if (force || params.estimatedMonthlySalesValue === undefined) params.estimatedMonthlySalesValue = categoryPolicySnapshot.estimatedMonthlySalesValue ?? undefined;
    if (force || params.roundingRule === undefined) params.roundingRule = categoryPolicySnapshot.roundingRule as any;
    serviceWarnings.push("La politica de categoria usa gasto asignado a categoria, no gasto total de sucursal.");
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
    if (!expenseAllocationScope) {
      expenseAllocationScope = ["CZ", "BZ", "CY"].includes(commercialIntelligenceSnapshot.combinedClass) ? "CATEGORY" : "BRANCH";
    }
    if (commercialIntelligenceSnapshot.combinedClass === "CZ" && expenseAllocationScope === "PRODUCT") {
      serviceWarnings.push("Producto CZ: evita prorratear como stock normal con gasto global; considera categoria, manual por unidad o bajo pedido.");
    }
  }

  const result = calculatePricingSuggestion({
    ...params,
    monthlyOperatingExpenses: monthlyOperatingExpenses ?? 0,
    estimatedMonthlyUnits: estimatedMonthlyUnits ?? 1,
    branchMonthlyUnits,
    categoryMonthlyUnits,
    productMonthlyUnits,
    expenseAllocationScope,
    marginPercent,
    prorateMethod,
  });
  result.warnings.push(...serviceWarnings);
  result.scopeWarnings.push(...serviceWarnings);

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
    effectivePrice: pricing.effectivePrice === null ? null : Number(pricing.effectivePrice),
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
  const snapshot = input.calculationSnapshot;
  const snapshotRecord = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot as Record<string, any>
    : null;
  const snapshotBlockReason = typeof snapshotRecord?.applyBlockReason === "string"
    ? snapshotRecord.applyBlockReason
    : null;
  const snapshotCanApplyPrice = typeof snapshotRecord?.canApplyPrice === "boolean"
    ? snapshotRecord.canApplyPrice
    : undefined;
  const snapshotMarketConflictType = typeof snapshotRecord?.marketConflict?.type === "string"
    ? snapshotRecord.marketConflict.type
    : null;
  const blockReason = input.applyBlockReason ?? snapshotBlockReason ?? snapshotMarketConflictType;
  const cannotApply = input.canApplyPrice === false
    || snapshotCanApplyPrice === false
    || blockReason === "MARKET_MAX_BELOW_MIN_PRICE"
    || (input.minPrice !== undefined && input.maxPrice !== undefined && input.maxPrice !== null && input.maxPrice < input.minPrice)
    || (input.totalInternalCost !== undefined && input.suggestedPrice < input.totalInternalCost);

  if (cannotApply) {
    const error = new Error("PRICE_APPLICATION_BLOCKED");
    (error as any).details = {
      reason: blockReason ?? "PRICE_BELOW_PROFITABLE_MINIMUM",
      minPrice: input.minPrice ?? null,
      maxPrice: input.maxPrice ?? null,
      totalInternalCost: input.totalInternalCost ?? null,
      suggestedPrice: input.suggestedPrice,
    };
    throw error;
  }

  if (input.maxPrice !== undefined && input.maxPrice !== null && input.suggestedPrice > input.maxPrice) {
    warnings.push("El precio sugerido supera el precio maximo de mercado indicado.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const branchId = input.branchId!;
    const newPrice = new Prisma.Decimal(input.suggestedPrice);

    const existing = await tx.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId, productId: input.productId } },
      select: { branchPrice: true },
    });
    const previousPrice = existing?.branchPrice ?? null;
    await tx.branchProductSetting.upsert({
      where: { branchId_productId: { branchId, productId: input.productId } },
      create: { branchId, productId: input.productId, branchPrice: newPrice },
      update: { branchPrice: newPrice },
    });
    const priceSourceAfter: "BRANCH" = "BRANCH";

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
