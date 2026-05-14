/**
 * Dynamic Pricing Engine
 * Calculates price recommendations based on ABC-XYZ classification,
 * rotation index, stock levels, and operating expenses.
 *
 * BUG FIX: Division by zero when estimatedMonthlyUnits is 0.
 * BUG FIX: Prevent negative final prices.
 * BUG FIX: Velocity comparison always true (avgDailySales compared to itself).
 * BUG FIX: Guard against negative costs or margins.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateSuggestedMarginForProduct } from "./abc-classifier";

export type DynamicPriceResult = {
  productId: string;
  productName: string;
  sku: string;
  purchaseCost: number;
  operatingExpensePerUnit: number;
  basePrice: number;
  adjustmentFactor: number;
  adjustmentReasons: string[];
  finalPrice: number;
  suggestedMargin: number;
  abcClass: string;
  xyzClass: string;
  rotationIndex: number;
  daysInStock: number;
};

/**
 * Calculate dynamic price for a single product.
 * Price Base = (Cost + Prorated Expenses) / (1 - Margin)
 * Factor = stock level + velocity + days in stock adjustments
 * Final Price = Base * (1 + Factor)
 */
export async function calculateDynamicPrice(
  productId: string,
  branchId?: string,
): Promise<DynamicPriceResult | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { inventoryBalances: true },
  });
  if (!product) return null;

  // Get pricing config for the branch (or first available)
  const configWhere = branchId ? { branchId } : undefined;
  const pricingConfig = configWhere
    ? await prisma.pricingConfig.findUnique({ where: { branchId: configWhere.branchId } })
    : await prisma.pricingConfig.findFirst({ where: { isActive: true } });

  // Get average cost from inventory
  const balances = product.inventoryBalances;
  const relevantBalances = branchId ? balances.filter((b) => b.branchId === branchId) : balances;
  const avgCost =
    relevantBalances.length > 0
      ? relevantBalances.reduce((s, b) => s + Number(b.weightedAverageCost), 0) / relevantBalances.length
      : Number(product.standardSalePrice) * 0.6; // Fallback: 60% of sale price

  // Get operating expenses per unit
  const targetBranchId = branchId ?? relevantBalances[0]?.branchId;
  let opExpPerUnit = 0;
  if (targetBranchId && pricingConfig) {
    const totalExpenses = await prisma.operatingExpense.aggregate({
      _sum: { amount: true },
      where: { branchId: targetBranchId, isActive: true },
    });
    const estimatedUnits = Number(pricingConfig.estimatedMonthlyUnits);
    // BUG FIX: Guard against division by zero when estimatedMonthlyUnits is 0
    opExpPerUnit = estimatedUnits > 0
      ? Number(totalExpenses._sum.amount ?? 0) / estimatedUnits
      : 0;
  }

  // Calculate suggested margin
  const suggestedMargin = calculateSuggestedMarginForProduct(product);
  const marginDecimal = suggestedMargin / 100;

  // BUG FIX: Guard against negative costs
  const safeCost = Math.max(0, avgCost);
  const safeOpExp = Math.max(0, opExpPerUnit);

  // Base price = (cost + expenses) / (1 - margin)
  const totalCost = safeCost + safeOpExp;
  // BUG FIX: Guard against marginDecimal >= 1 (would cause division by zero or negative price)
  const basePrice = marginDecimal < 0.99 ? totalCost / (1 - marginDecimal) : totalCost * 2;

  // Calculate adjustment factor
  let adjustmentFactor = 0;
  const adjustmentReasons: string[] = [];

  // Stock level adjustment
  const totalOnHand = relevantBalances.reduce((s, b) => s + Number(b.quantityOnHand), 0);
  const avgDailySales = Number(product.averageDailySales ?? 0);
  const monthlyAvg = avgDailySales * 30;

  if (monthlyAvg > 0) {
    if (totalOnHand > monthlyAvg * 2) {
      adjustmentFactor -= 0.10;
      adjustmentReasons.push("Stock alto (>2× promedio mensual): -10%");
    } else if (totalOnHand < monthlyAvg * 0.5) {
      adjustmentFactor += 0.10;
      adjustmentReasons.push("Stock bajo (<0.5× promedio mensual): +10%");
    }

    // BUG FIX: Velocity adjustment — compare daily sales to daily average (not to itself)
    // High velocity = sales above average (more than 2× daily average)
    // Low velocity = sales well below average
    const daysOfStock = avgDailySales > 0 ? totalOnHand / avgDailySales : 999;
    if (daysOfStock < 15) {
      // Stock will run out in less than 15 days — high velocity
      adjustmentFactor -= 0.05;
      adjustmentReasons.push("Alta velocidad de rotación (stock < 15 días): -5%");
    } else if (daysOfStock > 60) {
      // Stock will last more than 60 days — low velocity
      adjustmentFactor += 0.10;
      adjustmentReasons.push("Baja velocidad de rotación (stock > 60 días): +10%");
    }
  }

  // Days in stock adjustment
  const daysInStock = product.daysInStock ?? 0;
  if (daysInStock > 90) {
    adjustmentFactor -= 0.15;
    adjustmentReasons.push(`${daysInStock} días en stock: -15% (liquidación)`);
  } else if (daysInStock > 60) {
    adjustmentFactor -= 0.10;
    adjustmentReasons.push(`${daysInStock} días en stock: -10%`);
  } else if (daysInStock > 30) {
    adjustmentFactor -= 0.05;
    adjustmentReasons.push(`${daysInStock} días en stock: -5%`);
  }

  // BUG FIX: Ensure final price is never negative
  const rawFinalPrice = basePrice * (1 + adjustmentFactor);
  const finalPrice = Math.max(0.01, Math.round(rawFinalPrice * 100) / 100);

  return {
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    purchaseCost: Math.round(safeCost * 100) / 100,
    operatingExpensePerUnit: Math.round(safeOpExp * 100) / 100,
    basePrice: Math.round(basePrice * 100) / 100,
    adjustmentFactor: Math.round(adjustmentFactor * 1000) / 1000,
    adjustmentReasons,
    finalPrice,
    suggestedMargin,
    abcClass: product.abcClassification ?? "—",
    xyzClass: product.xyzClassification ?? "—",
    rotationIndex: Number(product.rotationIndex ?? 0),
    daysInStock,
  };
}

/**
 * Get dynamic prices for multiple products with filters.
 */
export async function getBulkDynamicPrices(filters?: {
  branchId?: string;
  abcClass?: string;
  xyzClass?: string;
  minRotation?: number;
  maxDaysInStock?: number;
  take?: number;
}) {
  const where: Record<string, unknown> = { isActive: true };
  if (filters?.abcClass) where.abcClassification = filters.abcClass;
  if (filters?.xyzClass) where.xyzClassification = filters.xyzClass;
  if (filters?.minRotation !== undefined) where.rotationIndex = { gte: filters.minRotation };
  if (filters?.maxDaysInStock !== undefined) where.daysInStock = { lte: filters.maxDaysInStock };

  const products = await prisma.product.findMany({
    where,
    select: { id: true },
    take: filters?.take ?? 100,
  });

  const results: DynamicPriceResult[] = [];
  for (const p of products) {
    const result = await calculateDynamicPrice(p.id, filters?.branchId);
    if (result) results.push(result);
  }

  return results;
}
