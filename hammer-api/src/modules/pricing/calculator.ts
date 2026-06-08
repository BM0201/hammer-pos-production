import { Prisma } from "@prisma/client";

export type PricingMode = "SIMPLE" | "ADVANCED";
export type ProrateMethod = "BY_QUANTITY" | "BY_VALUE";
export type ExpenseAllocationScope = "BRANCH" | "CATEGORY" | "PRODUCT" | "MANUAL";
export type OperatingExpenseSource =
  | "BRANCH_TOTAL"
  | "CATEGORY_ALLOCATION"
  | "PRODUCT_ALLOCATION"
  | "MANUAL_PER_UNIT"
  | "LEGACY_ESTIMATED_UNITS";
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
  expenseAllocationScope?: ExpenseAllocationScope;
  manualOperatingExpensePerUnit?: number | string | Prisma.Decimal;
  branchMonthlyUnits?: number | string | Prisma.Decimal;
  categoryMonthlyUnits?: number | string | Prisma.Decimal;
  productMonthlyUnits?: number | string | Prisma.Decimal;
  expenseScopeLabel?: string;
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
  expenseAllocationScope: ExpenseAllocationScope;
  expenseScopeLabel: string;
  unitsUsedForProration: number;
  operatingExpenseSource: OperatingExpenseSource;
  scopeWarnings: string[];
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
  marketConflict?: {
    hasConflict: boolean;
    type: "MARKET_MAX_BELOW_MIN_PRICE" | null;
    minPrice: number;
    marketMaxPrice: number | null;
    gapAmount: number | null;
    recommendation: "REVIEW_COSTS" | "ON_DEMAND" | "DO_NOT_STOCK" | "NEGOTIATE_SUPPLIER" | null;
  };
  canApplyPrice: boolean;
  applyBlockReason?: string | null;
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

function scopeLabel(scope: ExpenseAllocationScope, custom?: string) {
  if (custom?.trim()) return custom.trim();
  if (scope === "CATEGORY") return "Categoria/familia";
  if (scope === "PRODUCT") return "Producto especifico";
  if (scope === "MANUAL") return "Manual por unidad";
  return "Sucursal completa";
}

function sourceForScope(scope: ExpenseAllocationScope, legacy: boolean): OperatingExpenseSource {
  if (legacy) return "LEGACY_ESTIMATED_UNITS";
  if (scope === "CATEGORY") return "CATEGORY_ALLOCATION";
  if (scope === "PRODUCT") return "PRODUCT_ALLOCATION";
  if (scope === "MANUAL") return "MANUAL_PER_UNIT";
  return "BRANCH_TOTAL";
}

function unitsForScope(input: PricingSuggestionInput, scope: ExpenseAllocationScope, legacyUnits: Prisma.Decimal) {
  if (scope === "CATEGORY") return decimal(input.categoryMonthlyUnits, legacyUnits);
  if (scope === "PRODUCT") return decimal(input.productMonthlyUnits, legacyUnits);
  if (scope === "BRANCH") return decimal(input.branchMonthlyUnits, legacyUnits);
  return ONE;
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
  const scopeWarnings: string[] = [];
  const legacyScope = input.expenseAllocationScope === undefined;
  const expenseAllocationScope: ExpenseAllocationScope = input.expenseAllocationScope ?? "BRANCH";
  const expenseScopeLabel = scopeLabel(expenseAllocationScope, input.expenseScopeLabel);
  let operatingExpenseSource = sourceForScope(expenseAllocationScope, legacyScope);
  let unitsUsedForProration = unitsForScope(input, expenseAllocationScope, estimatedMonthlyUnits);

  if (legacyScope) {
    scopeWarnings.push("No se especifico ambito de prorrateo; se uso compatibilidad legacy.");
  }

  if (expenseAllocationScope === "MANUAL") {
    const manualOperatingExpensePerUnit = decimal(input.manualOperatingExpensePerUnit);
    if (input.manualOperatingExpensePerUnit === undefined || input.manualOperatingExpensePerUnit === "") {
      scopeWarnings.push("No se indico gasto operativo manual por unidad; se uso 0.");
    }
    unitsUsedForProration = ONE;
    operatingExpenseSource = "MANUAL_PER_UNIT";
    operatingExpensePerUnit = manualOperatingExpensePerUnit;
  } else if (prorateMethod === "BY_VALUE") {
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
      unitsUsedForProration = estimatedMonthlyUnitsForThisProduct;
    } else {
      warnings.push("Para prorratear por valor se requiere venta mensual estimada total y valor mensual estimado del producto.");
      warnings.push("Se aplico fallback a prorrateo por cantidad.");
      fallbackApplied = true;
      fallbackMethod = "BY_QUANTITY";
      effectiveProrateMethod = "BY_QUANTITY";
      if (unitsUsedForProration.lte(ZERO)) unitsUsedForProration = ONE;
      operatingExpensePerUnit = monthlyOperatingExpenses.div(unitsUsedForProration);
    }
  } else {
    if (unitsUsedForProration.lte(ZERO)) {
      unitsUsedForProration = ONE;
      scopeWarnings.push("Las unidades del ambito de prorrateo deben ser mayores que cero; se uso 1 como minimo tecnico.");
    }
    operatingExpensePerUnit = monthlyOperatingExpenses.div(unitsUsedForProration);
  }

  if (expenseAllocationScope === "BRANCH" && unitsUsedForProration.lt(100)) {
    scopeWarnings.push("Las unidades de sucursal parecen muy bajas; verifica que no estes usando unidades de producto.");
  }
  if (expenseAllocationScope === "CATEGORY" && monthlyOperatingExpenses.gte(5000) && unitsUsedForProration.lt(50)) {
    scopeWarnings.push("El gasto asignado a categoria parece alto para pocas unidades; verifica que no sea gasto total de sucursal.");
  }
  if (expenseAllocationScope === "PRODUCT") {
    scopeWarnings.push("Estas prorrateando gastos sobre un producto especifico; asegurate de que el gasto mensual pertenezca solo a este producto.");
    if (monthlyOperatingExpenses.gte(5000) && unitsUsedForProration.lt(50)) {
      scopeWarnings.push("Posible mezcla de gasto global con unidades de producto. El precio puede quedar inflado.");
    }
  }
  warnings.push(...scopeWarnings);

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
  let marketConflict: PricingSuggestionResult["marketConflict"] = {
    hasConflict: false,
    type: null,
    minPrice: money(minPrice),
    marketMaxPrice: maxPrice ? money(maxPrice) : null,
    gapAmount: null,
    recommendation: null,
  };
  let canApplyPrice = true;
  let applyBlockReason: string | null = null;

  if (maxPrice && maxPrice.lt(minPrice)) {
    const gap = minPrice.sub(maxPrice);
    marketConflict = {
      hasConflict: true,
      type: "MARKET_MAX_BELOW_MIN_PRICE",
      minPrice: money(minPrice),
      marketMaxPrice: money(maxPrice),
      gapAmount: money(gap),
      recommendation: expenseAllocationScope === "PRODUCT" ? "REVIEW_COSTS" : "NEGOTIATE_SUPPLIER",
    };
    canApplyPrice = false;
    applyBlockReason = "MARKET_MAX_BELOW_MIN_PRICE";
    warnings.push("El precio minimo rentable supera el precio maximo de mercado.");
    warnings.push("Este producto no es rentable con la estructura de costos actual.");
    warnings.push("Revisa gasto asignado, ambito de prorrateo, proveedor o considera vender bajo pedido/no stockear.");
  } else if (maxPrice && suggestedPrice.gt(maxPrice)) {
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
    expenseAllocationScope,
    expenseScopeLabel,
    unitsUsedForProration: toNumber(unitsUsedForProration),
    operatingExpenseSource,
    scopeWarnings,
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
    marketConflict,
    canApplyPrice,
    applyBlockReason,
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
