export type ReorderSimulation = {
  suggestedQuantity: number;
  estimatedCost: number;
  coverageDaysAfterPurchase: number | null;
  overstockRisk: "LOW" | "MEDIUM" | "HIGH";
  priority: number;
};

export function simulateReorder(input: {
  quantityAvailable: number;
  dailyDemandAvg: number;
  targetQuantity: number;
  safetyStock?: number;
  unitCost?: number;
  leadTimeDays?: number;
}): ReorderSimulation {
  const target = Math.max(0, input.targetQuantity + (input.safetyStock ?? 0));
  const suggestedQuantity = Math.max(0, Math.ceil(target - input.quantityAvailable));
  const afterPurchase = input.quantityAvailable + suggestedQuantity;
  const coverageDaysAfterPurchase = input.dailyDemandAvg > 0
    ? afterPurchase / input.dailyDemandAvg
    : null;
  const leadTimeDays = Math.max(0, input.leadTimeDays ?? 0);
  const stockoutBeforeLeadTime = input.dailyDemandAvg > 0
    ? input.quantityAvailable / input.dailyDemandAvg < leadTimeDays
    : false;
  const overstockRisk = coverageDaysAfterPurchase === null
    ? "MEDIUM"
    : coverageDaysAfterPurchase > 90
      ? "HIGH"
      : coverageDaysAfterPurchase > 45
        ? "MEDIUM"
        : "LOW";

  return {
    suggestedQuantity,
    estimatedCost: Number((suggestedQuantity * Math.max(0, input.unitCost ?? 0)).toFixed(2)),
    coverageDaysAfterPurchase: coverageDaysAfterPurchase === null ? null : Number(coverageDaysAfterPurchase.toFixed(1)),
    overstockRisk,
    priority: stockoutBeforeLeadTime ? 92 : suggestedQuantity > 0 ? 78 : 20,
  };
}
