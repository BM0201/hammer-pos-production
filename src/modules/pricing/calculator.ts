import { Prisma } from "@prisma/client";

/**
 * ════════════════════════════════════════════════════════════
 *  HAMMER — Módulo de Cálculo de Precio Sugerido
 * ════════════════════════════════════════════════════════════
 *
 * Fórmula:
 *   Gastos Mensuales Totales / Unidades Vendidas Estimadas = Gasto por Unidad
 *   Costo Total = Costo de Compra + Gasto por Unidad
 *   Precio Sugerido = Costo Total ÷ (1 − Margen de Utilidad)
 *
 * Ejemplo:
 *   Gastos mensuales = C$50,000
 *   Unidades estimadas = 1,000
 *   Gasto por unidad = C$50
 *   Costo de compra del cemento = C$400
 *   Costo total = C$400 + C$50 = C$450
 *   Margen deseado = 7%
 *   Precio sugerido = C$450 / (1 - 0.07) = C$483.87
 */

export type SuggestedPriceInput = {
  /** Cost per unit from purchase */
  purchaseCostPerUnit: Prisma.Decimal;
  /** Total monthly operating expenses for the branch */
  totalMonthlyExpenses: Prisma.Decimal;
  /** Estimated monthly units sold */
  estimatedMonthlyUnits: Prisma.Decimal;
  /** Desired profit margin as percentage (e.g. 30 = 30%) */
  desiredMarginPercent: Prisma.Decimal;
};

export type SuggestedPriceResult = {
  purchaseCost: Prisma.Decimal;
  operatingExpensePerUnit: Prisma.Decimal;
  totalCostPerUnit: Prisma.Decimal;
  marginPercent: Prisma.Decimal;
  suggestedPrice: Prisma.Decimal;
  totalMonthlyExpenses: Prisma.Decimal;
  estimatedMonthlyUnits: Prisma.Decimal;
};

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);
const HUNDRED = new Prisma.Decimal(100);

/**
 * Calculate the suggested selling price for a product.
 *
 * @throws Error if margin >= 100% or estimatedMonthlyUnits <= 0
 */
export function calculateSuggestedPrice(input: SuggestedPriceInput): SuggestedPriceResult {
  const { purchaseCostPerUnit, totalMonthlyExpenses, estimatedMonthlyUnits, desiredMarginPercent } = input;

  if (desiredMarginPercent.gte(HUNDRED)) {
    throw new Error("INVALID_MARGIN: El margen no puede ser >= 100%");
  }
  if (estimatedMonthlyUnits.lte(ZERO)) {
    throw new Error("INVALID_UNITS: Las unidades estimadas deben ser > 0");
  }
  if (purchaseCostPerUnit.lt(ZERO)) {
    throw new Error("INVALID_COST: El costo de compra no puede ser negativo");
  }

  // Gasto por unidad = Gastos Mensuales / Unidades Estimadas
  const operatingExpensePerUnit = totalMonthlyExpenses.div(estimatedMonthlyUnits);

  // Costo Total = Costo Compra + Gasto por Unidad
  const totalCostPerUnit = purchaseCostPerUnit.add(operatingExpensePerUnit);

  // Precio Sugerido = Costo Total / (1 - Margen/100)
  const marginFraction = desiredMarginPercent.div(HUNDRED);
  const divisor = ONE.sub(marginFraction);
  const suggestedPrice = totalCostPerUnit.div(divisor);

  return {
    purchaseCost: purchaseCostPerUnit,
    operatingExpensePerUnit: new Prisma.Decimal(operatingExpensePerUnit.toFixed(4)),
    totalCostPerUnit: new Prisma.Decimal(totalCostPerUnit.toFixed(4)),
    marginPercent: desiredMarginPercent,
    suggestedPrice: new Prisma.Decimal(suggestedPrice.toFixed(2)),
    totalMonthlyExpenses,
    estimatedMonthlyUnits,
  };
}

/**
 * Quick helper: calculate suggested price from simple numbers (useful for API).
 */
export function calculateSuggestedPriceSimple(input: {
  purchaseCostPerUnit: number;
  totalMonthlyExpenses: number;
  estimatedMonthlyUnits: number;
  desiredMarginPercent: number;
}): SuggestedPriceResult {
  return calculateSuggestedPrice({
    purchaseCostPerUnit: new Prisma.Decimal(input.purchaseCostPerUnit),
    totalMonthlyExpenses: new Prisma.Decimal(input.totalMonthlyExpenses),
    estimatedMonthlyUnits: new Prisma.Decimal(input.estimatedMonthlyUnits),
    desiredMarginPercent: new Prisma.Decimal(input.desiredMarginPercent),
  });
}
