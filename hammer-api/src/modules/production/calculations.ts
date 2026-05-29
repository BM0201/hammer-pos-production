/**
 * Production cost & pricing calculations.
 */

export interface CostBreakdown {
  materialsCost: number;
  laborCost: number;
  overheadCost: number;
  totalCost: number;
  unitCost: number;
  suggestedPrice: number | null;
}

/**
 * Calculate the full cost breakdown for a production batch.
 */
export function calculateBatchCosts(params: {
  inputs: Array<{ actualQuantity: number; unitCost: number }>;
  laborCost: number;
  overheadCost: number;
  producedGoodQuantity: number;
  targetMarginPct?: number | null;
}): CostBreakdown {
  const { inputs, laborCost, overheadCost, producedGoodQuantity, targetMarginPct } = params;

  const materialsCost = inputs.reduce((sum, i) => sum + i.actualQuantity * i.unitCost, 0);
  const totalCost = materialsCost + laborCost + overheadCost;
  const unitCost = producedGoodQuantity > 0 ? totalCost / producedGoodQuantity : 0;

  let suggestedPrice: number | null = null;
  if (targetMarginPct != null && targetMarginPct > 0 && targetMarginPct < 1) {
    suggestedPrice = unitCost / (1 - targetMarginPct);
  }

  return {
    materialsCost: round2(materialsCost),
    laborCost: round2(laborCost),
    overheadCost: round2(overheadCost),
    totalCost: round2(totalCost),
    unitCost: round2(unitCost),
    suggestedPrice: suggestedPrice != null ? round2(suggestedPrice) : null,
  };
}

/**
 * Estimate material cost for a recipe given current WAC prices.
 */
export function estimateMaterialCost(
  recipeInputs: Array<{ quantity: number; unitCost: number }>,
  multiplier: number,
): number {
  return round2(
    recipeInputs.reduce((sum, i) => sum + i.quantity * multiplier * i.unitCost, 0),
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
