import assert from "node:assert/strict";
import test from "node:test";
import { calculateTimberTrip, type TimberTripLineInput } from "@/modules/timber/calculator";

const PRICING = {
  costPerFoot: 20,
  pricePerInchTabla: 8.9,
  pricePerInchTablilla: 6.9,
  pricePerInchCuadro: 6.9,
};

// 1"×12"×16' tabla → boardFeet = (1×12×16)/12 = 16 pies per piece.
const lines: TimberTripLineInput[] = [
  { thickness: 1, width: 12, length: 16, pieces: 10, priceGroup: "TABLA" },
];

test("timber trip: TOTAL mode derives cost per foot from trip total", () => {
  const result = calculateTimberTrip(lines, 3200, PRICING);
  // 10 pieces × 16 pies = 160 pies; 3200 / 160 = 20 C$/pie
  assert.equal(result.totals.totalFeet, 160);
  assert.equal(result.totals.computedCostPerFoot, 20);
  assert.equal(result.totals.woodTripTotalCost, 3200);
});

test("timber trip: PER_FOOT mode uses entered price per foot directly", () => {
  const result = calculateTimberTrip(lines, 0, PRICING, { costPerFootInput: 52 });
  // computedCostPerFoot must equal the entered 52 (not derived)
  assert.equal(result.totals.computedCostPerFoot, 52);
  // total is derived: 52 × 160 pies = 8320
  assert.equal(result.totals.woodTripTotalCost, 8320);
  // line cost feet = 160 × 52 = 8320
  assert.equal(result.totals.totalCostFeet, 8320);
});

test("timber trip: PER_FOOT overrides any provided trip total", () => {
  const result = calculateTimberTrip(lines, 999999, PRICING, { costPerFootInput: 52 });
  assert.equal(result.totals.computedCostPerFoot, 52);
  assert.equal(result.totals.woodTripTotalCost, 8320);
});

test("timber trip: PER_FOOT ignored when value is not positive", () => {
  const result = calculateTimberTrip(lines, 3200, PRICING, { costPerFootInput: 0 });
  assert.equal(result.totals.computedCostPerFoot, 20);
});
