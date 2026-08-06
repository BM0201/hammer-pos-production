export type PriceSimulation = {
  currentMarginAmount: number;
  currentMarginPercent: number;
  suggestedMarginAmount: number;
  suggestedMarginPercent: number;
  unitImpact: number;
  estimatedImpactAtCurrentVolume: number;
  priceIncreaseRisk: "LOW" | "MEDIUM" | "HIGH";
};

function marginPercent(price: number, cost: number) {
  if (price <= 0) return -100;
  return ((price - cost) / price) * 100;
}

export function simulatePriceChange(input: {
  currentPrice: number;
  cost: number;
  suggestedPrice: number;
  recentUnits?: number;
}): PriceSimulation {
  const currentMarginAmount = input.currentPrice - input.cost;
  const suggestedMarginAmount = input.suggestedPrice - input.cost;
  const unitImpact = suggestedMarginAmount - currentMarginAmount;
  const increasePct = input.currentPrice > 0
    ? ((input.suggestedPrice - input.currentPrice) / input.currentPrice) * 100
    : 0;

  return {
    currentMarginAmount: Number(currentMarginAmount.toFixed(2)),
    currentMarginPercent: Number(marginPercent(input.currentPrice, input.cost).toFixed(1)),
    suggestedMarginAmount: Number(suggestedMarginAmount.toFixed(2)),
    suggestedMarginPercent: Number(marginPercent(input.suggestedPrice, input.cost).toFixed(1)),
    unitImpact: Number(unitImpact.toFixed(2)),
    estimatedImpactAtCurrentVolume: Number((unitImpact * Math.max(0, input.recentUnits ?? 0)).toFixed(2)),
    priceIncreaseRisk: increasePct >= 25 ? "HIGH" : increasePct >= 12 ? "MEDIUM" : "LOW",
  };
}
