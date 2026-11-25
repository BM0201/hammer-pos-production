import assert from "node:assert/strict";
import test from "node:test";
import { branchPriceSpread, expensePerUnitForRate, expenseRateFrom } from "@/modules/pricing/branch-comparison-service";

test("branchPriceSpread: dispersión entre sucursales, ignora ceros y una sola sucursal", () => {
  assert.deepEqual(branchPriceSpread([100, 112, 105]), { min: 100, max: 112, spreadPercent: 12 });
  assert.equal(branchPriceSpread([100]), null);
  assert.equal(branchPriceSpread([0, 100]), null);
});

test("% de gasto: el gasto se reparte como parte de cada venta, no entre unidades a mano", () => {
  assert.equal(expenseRateFrom(15000, 100000), 15);
  assert.equal(expenseRateFrom(5000, 0), null); // sin ventas no hay %
  // costo 100, margen 30%, gasto 15% → precio 100/0.55 = 181.82, gasto = 27.27 (15% de 181.82)
  assert.equal(expensePerUnitForRate(100, 30, 15), 27.27);
  assert.equal(expensePerUnitForRate(100, 30, null), 0);
  // margen + gasto absurdos: tope, no un precio infinito
  assert.equal(expensePerUnitForRate(100, 60, 50), 500);
});
