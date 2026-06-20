import assert from "node:assert/strict";
import test from "node:test";
import { calculatePricingSuggestion } from "@/modules/pricing/calculator";

test("pricing: BY_VALUE fallback reports effective BY_QUANTITY", () => {
  const result = calculatePricingSuggestion({
    mode: "ADVANCED",
    baseCost: 100,
    monthlyOperatingExpenses: 1000,
    estimatedMonthlyUnits: 100,
    prorateMethod: "BY_VALUE",
    marginPercent: 25,
  });

  assert.equal(result.fallbackApplied, true);
  assert.equal(result.fallbackMethod, "BY_QUANTITY");
  assert.equal(result.prorateMethod, "BY_QUANTITY");
});
