import { Prisma } from "@prisma/client";

export type PricingMode = "SIMPLE" | "ADVANCED";
export type ProrateMethod = "BY_QUANTITY" | "BY_VALUE";
export type RoundingRule =
  | "NONE"
  | "NEAREST_1"
  | "NEAREST_5"
  | "NEAREST_10"
  | "NEAREST_50"
  | "NEAREST_100"
  | "ENDING_9"
  | "ENDING_90"
  | "ENDING_99";

export type PricingSuggestionInput = {
  mode?: PricingMode;
  baseCost: number | string | Prisma.Decimal;
  taxPercent?: number | string | Prisma.Decimal;
  includeTaxInCost?: boolean;
  purchaseFreightPerUnit?: number | string | Prisma.Decimal;
  otherCostPerUnit?: number | string | Prisma.Decimal;
  shrinkagePercent?: number | string | Prisma.Decimal;
  monthlyOperatingExpenses?: number | string | Prisma.Decimal;
  estimatedMonthlyUnits?: number | string | Prisma.Decimal;
  prorateMethod?: ProrateMethod;
  estimatedMonthlySalesValue?: number | string | Prisma.Decimal;
  productMonthlySalesValue?: number | string | Prisma.Decimal;
  estimatedMonthlyUnitsForThisProduct?: number | string | Prisma.Decimal;
  marginPercent: number | string | Prisma.Decimal;
  minProfitAmount?: number | string | Prisma.Decimal;
  marketMinPrice?: number | string | Prisma.Decimal;
  marketMaxPrice?: number | string | Prisma.Decimal;
  roundingRule?: RoundingRule;
};

export type PricingSuggestionResult = {
  mode: PricingMode;
  baseCost: number;
  taxPercent: number;
  taxAmount: number;
  includeTaxInCost: boolean;
  purchaseFreightPerUnit: number;
  otherCostPerUnit: number;
  shrinkagePercent: number;
  shrinkageAmount: number;
  landedCost: number;
  monthlyOperatingExpenses: number;
  estimatedMonthlyUnits: number;
  prorateMethod: ProrateMethod;
  operatingExpensePerUnit: number;
  totalInternalCost: number;
  marginPercent: number;
  markupPercent: number;
  minProfitAmount: number;
  rawSuggestedPrice: number;
  suggestedPrice: number;
  minPrice: number;
  maxPrice: number | null;
  grossProfit: number;
  grossMarginPercent: number;
  priceFloorReason: "MARGIN" | "MIN_PROFIT" | "MARKET_MIN" | "NONE";
  roundingRule: RoundingRule;
  warnings: string[];
  fallbackApplied?: boolean;
  fallbackMethod?: "BY_QUANTITY";
  expenseAllocationRatio?: number;
  allocatedMonthlyExpense?: number;

  // Legacy aliases kept for existing callers and screens.
  purchaseCost: number;
  totalCostPerUnit: number;
  totalMonthlyExpenses: number;
  desiredMarginPercent: number;
};

export type SuggestedPriceInput = {
  purchaseCostPerUnit: Prisma.Decimal;
  totalMonthlyExpenses: Prisma.Decimal;
  estimatedMonthlyUnits: Prisma.Decimal;
  desiredMarginPercent: Prisma.Decimal;
};

export type SuggestedPriceResult = PricingSuggestionResult;

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);
const HUNDRED = new Prisma.Decimal(100);

function decimal(value: number | string | Prisma.Decimal | undefined, fallback = ZERO) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = new Prisma.Decimal(value);
  return parsed.isFinite() ? parsed : fallback;
}

function toNumber(value: Prisma.Decimal) {
  const num = Number(value.toFixed(6));
  return Number.isFinite(num) ? num : 0;
}

function money(value: Prisma.Decimal) {
  return toNumber(new Prisma.Decimal(value.toFixed(2)));
}

function roundNearest(value: Prisma.Decimal, increment: number) {
  if (increment <= 1) return new Prisma.Decimal(Math.round(toNumber(value)));
  return new Prisma.Decimal(Math.round(toNumber(value) / increment) * increment);
}

function roundEnding(value: Prisma.Decimal, ending: 9 | 90 | 99) {
  const min = toNumber(value);
  const scale = ending === 9 ? 10 : 100;
  let candidate = Math.floor(min / scale) * scale + ending;
  if (candidate < min) candidate += scale;
  return new Prisma.Decimal(candidate);
}

export function applyRounding(value: Prisma.Decimal, rule: RoundingRule): Prisma.Decimal {
  switch (rule) {
    case "NEAREST_1":
      return roundNearest(value, 1);
    case "NEAREST_5":
      return roundNearest(value, 5);
    case "NEAREST_10":
      return roundNearest(value, 10);
    case "NEAREST_50":
      return roundNearest(value, 50);
    case "NEAREST_100":
      return roundNearest(value, 100);
    case "ENDING_9":
      return roundEnding(value, 9);
    case "ENDING_90":
      return roundEnding(value, 90);
    case "ENDING_99":
      return roundEnding(value, 99);
    case "NONE":
    default:
      return value;
  }
}

export function calculatePricingSuggestion(input: PricingSuggestionInput): PricingSuggestionResult {
  const warnings: string[] = [];
  const mode = input.mode ?? "SIMPLE";
  const baseCost = decimal(input.baseCost);
  const taxPercent = decimal(input.taxPercent);
  const includeTaxInCost = input.includeTaxInCost ?? false;
  const purchaseFreightPerUnit = decimal(input.purchaseFreightPerUnit);
  const otherCostPerUnit = decimal(input.otherCostPerUnit);
  const shrinkagePercent = decimal(input.shrinkagePercent);
  const monthlyOperatingExpenses = decimal(input.monthlyOperatingExpenses);
  const prorateMethod = input.prorateMethod ?? "BY_QUANTITY";
  const marginPercent = decimal(input.marginPercent);
  const minProfitAmount = decimal(input.minProfitAmount);
  const marketMinPrice = input.marketMinPrice === undefined || input.marketMinPrice === "" ? null : decimal(input.marketMinPrice);
  const marketMaxPrice = input.marketMaxPrice === undefined || input.marketMaxPrice === "" ? null : decimal(input.marketMaxPrice);
  const roundingRule = input.roundingRule ?? "NONE";

  if (marginPercent.lte(ZERO) || marginPercent.gte(95)) {
    throw new Error("INVALID_MARGIN: El margen debe ser mayor que 0 y menor que 95%");
  }
  if (taxPercent.lt(ZERO) || taxPercent.gt(HUNDRED)) {
    throw new Error("INVALID_TAX: El IVA debe estar entre 0% y 100%");
  }
  if (shrinkagePercent.lt(ZERO) || shrinkagePercent.gt(HUNDRED)) {
    throw new Error("INVALID_SHRINKAGE: La merma debe estar entre 0% y 100%");
  }
  if (baseCost.lt(ZERO) || purchaseFreightPerUnit.lt(ZERO) || otherCostPerUnit.lt(ZERO) || monthlyOperatingExpenses.lt(ZERO) || minProfitAmount.lt(ZERO)) {
    throw new Error("INVALID_AMOUNT: Los montos no pueden ser negativos");
  }

  const taxAmount = includeTaxInCost ? baseCost.mul(taxPercent).div(HUNDRED) : ZERO;
  const preShrinkageCost = baseCost.add(taxAmount).add(purchaseFreightPerUnit).add(otherCostPerUnit);
  const shrinkageAmount = preShrinkageCost.mul(shrinkagePercent).div(HUNDRED);
  const landedCost = preShrinkageCost.add(shrinkageAmount);

  let estimatedMonthlyUnits = decimal(input.estimatedMonthlyUnits, ONE);
  if (estimatedMonthlyUnits.lte(ZERO)) {
    estimatedMonthlyUnits = ONE;
    warnings.push("Las unidades vendidas estimadas deben ser mayores que cero; se uso 1 como minimo tecnico.");
  }

  let operatingExpensePerUnit = ZERO;
  let effectiveProrateMethod = prorateMethod;
  let fallbackApplied = false;
  let fallbackMethod: "BY_QUANTITY" | undefined;
  let expenseAllocationRatio: Prisma.Decimal | undefined;
  let allocatedMonthlyExpense: Prisma.Decimal | undefined;

  if (prorateMethod === "BY_VALUE") {
    const estimatedMonthlySalesValue = decimal(input.estimatedMonthlySalesValue);
    const estimatedMonthlyUnitsForThisProduct = decimal(input.estimatedMonthlyUnitsForThisProduct);
    const productMonthlySalesValue = input.productMonthlySalesValue !== undefined && input.productMonthlySalesValue !== ""
      ? decimal(input.productMonthlySalesValue)
      : baseCost.mul(estimatedMonthlyUnitsForThisProduct);

    const hasByValueData = estimatedMonthlySalesValue.gt(ZERO)
      && productMonthlySalesValue.gt(ZERO)
      && estimatedMonthlyUnitsForThisProduct.gt(ZERO);

    if (hasByValueData) {
      expenseAllocationRatio = productMonthlySalesValue.div(estimatedMonthlySalesValue);
      allocatedMonthlyExpense = monthlyOperatingExpenses.mul(expenseAllocationRatio);
      operatingExpensePerUnit = allocatedMonthlyExpense.div(estimatedMonthlyUnitsForThisProduct);
    } else {
      warnings.push("Para prorratear por valor se requiere venta mensual estimada total y valor mensual estimado del producto.");
      warnings.push("Se aplico fallback a prorrateo por cantidad.");
      fallbackApplied = true;
      fallbackMethod = "BY_QUANTITY";
      effectiveProrateMethod = "BY_VALUE";
      operatingExpensePerUnit = monthlyOperatingExpenses.div(estimatedMonthlyUnits);
    }
  } else {
    operatingExpensePerUnit = monthlyOperatingExpenses.div(estimatedMonthlyUnits);
  }

  const totalInternalCost = landedCost.add(operatingExpensePerUnit);
  const marginFraction = marginPercent.div(HUNDRED);
  const priceByMargin = totalInternalCost.div(ONE.sub(marginFraction));
  const priceByMinProfit = totalInternalCost.add(minProfitAmount);

  let minPrice = priceByMargin;
  let priceFloorReason: PricingSuggestionResult["priceFloorReason"] = totalInternalCost.gt(ZERO) ? "MARGIN" : "NONE";

  if (priceByMinProfit.gt(minPrice)) {
    minPrice = priceByMinProfit;
    priceFloorReason = "MIN_PROFIT";
  }
  if (marketMinPrice && marketMinPrice.gt(minPrice)) {
    minPrice = marketMinPrice;
    priceFloorReason = "MARKET_MIN";
  }

  if (priceFloorReason === "MIN_PROFIT") warnings.push("La utilidad minima elevo el precio sugerido.");
  if (priceFloorReason === "MARKET_MIN") warnings.push("El precio minimo de mercado elevo el precio sugerido.");

  const rawSuggestedPrice = minPrice;
  const rounded = applyRounding(rawSuggestedPrice, roundingRule);
  const suggestedPrice = rounded.lt(minPrice) ? minPrice : rounded;
  const maxPrice = marketMaxPrice;

  if (maxPrice && suggestedPrice.gt(maxPrice)) {
    warnings.push("El precio sugerido supera el precio maximo de mercado indicado.");
  }

  const grossProfit = suggestedPrice.sub(totalInternalCost);
  const grossMarginPercent = suggestedPrice.gt(ZERO) ? grossProfit.div(suggestedPrice).mul(HUNDRED) : ZERO;
  const markupPercent = totalInternalCost.gt(ZERO) ? grossProfit.div(totalInternalCost).mul(HUNDRED) : ZERO;

  return {
    mode,
    baseCost: money(baseCost),
    taxPercent: toNumber(taxPercent),
    taxAmount: money(taxAmount),
    includeTaxInCost,
    purchaseFreightPerUnit: money(purchaseFreightPerUnit),
    otherCostPerUnit: money(otherCostPerUnit),
    shrinkagePercent: toNumber(shrinkagePercent),
    shrinkageAmount: money(shrinkageAmount),
    landedCost: money(landedCost),
    monthlyOperatingExpenses: money(monthlyOperatingExpenses),
    estimatedMonthlyUnits: toNumber(estimatedMonthlyUnits),
    prorateMethod: effectiveProrateMethod,
    operatingExpensePerUnit: money(operatingExpensePerUnit),
    totalInternalCost: money(totalInternalCost),
    marginPercent: toNumber(marginPercent),
    markupPercent: toNumber(markupPercent),
    minProfitAmount: money(minProfitAmount),
    rawSuggestedPrice: money(rawSuggestedPrice),
    suggestedPrice: money(suggestedPrice),
    minPrice: money(minPrice),
    maxPrice: maxPrice ? money(maxPrice) : null,
    grossProfit: money(grossProfit),
    grossMarginPercent: toNumber(grossMarginPercent),
    priceFloorReason,
    roundingRule,
    warnings,
    ...(fallbackApplied ? { fallbackApplied, fallbackMethod } : {}),
    ...(expenseAllocationRatio ? { expenseAllocationRatio: toNumber(expenseAllocationRatio.mul(HUNDRED)) / 100 } : {}),
    ...(allocatedMonthlyExpense ? { allocatedMonthlyExpense: money(allocatedMonthlyExpense) } : {}),
    purchaseCost: money(baseCost),
    totalCostPerUnit: money(totalInternalCost),
    totalMonthlyExpenses: money(monthlyOperatingExpenses),
    desiredMarginPercent: toNumber(marginPercent),
  };
}

export function calculateSuggestedPrice(input: SuggestedPriceInput): SuggestedPriceResult {
  return calculatePricingSuggestion({
    mode: "SIMPLE",
    baseCost: input.purchaseCostPerUnit,
    monthlyOperatingExpenses: input.totalMonthlyExpenses,
    estimatedMonthlyUnits: input.estimatedMonthlyUnits,
    marginPercent: input.desiredMarginPercent,
    prorateMethod: "BY_QUANTITY",
  });
}

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
