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

test("pricing: el redondeo de la Calculadora siempre sube (no come margen) y acepta C$0.50", () => {
  // 100 / 0.70 = 142.857 → al múltiplo de 5 más cercano sería 145, pero 141.2 → 140 perdía margen.
  const r5 = calculatePricingSuggestion({ baseCost: 98.84, marginPercent: 30, roundingRule: "NEAREST_5" }); // 141.2
  assert.equal(r5.suggestedPrice, 145);
  const r050 = calculatePricingSuggestion({ baseCost: 100, marginPercent: 30, roundingRule: "NEAREST_0_50" }); // 142.857
  assert.equal(r050.suggestedPrice, 143);
  const exact = calculatePricingSuggestion({ baseCost: 70, marginPercent: 30, roundingRule: "NEAREST_10" }); // 100 exacto
  assert.equal(exact.suggestedPrice, 100);
});

test("pricing: aviso de margen fuera del rango típico según clase ABC", () => {
  const lowA = calculatePricingSuggestion({ baseCost: 100, marginPercent: 10, abcClass: "A" });
  assert.ok(lowA.warnings.some((w) => w.includes("bajo para un producto de alta venta")));
  const highA = calculatePricingSuggestion({ baseCost: 100, marginPercent: 45, abcClass: "A" });
  assert.ok(highA.warnings.some((w) => w.includes("10% sobre la competencia")));
  const okC = calculatePricingSuggestion({ baseCost: 100, marginPercent: 45, abcClass: "C" });
  assert.ok(!okC.warnings.some((w) => w.includes("Margen ")));
  const okGeneric = calculatePricingSuggestion({ baseCost: 100, marginPercent: 30 });
  assert.ok(!okGeneric.warnings.some((w) => w.includes("Margen ")));
});
