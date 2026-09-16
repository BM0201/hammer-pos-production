import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateWacAgainstSalePrice,
  evaluateWacAgainstCostChain,
  pickCostChainReference,
  evaluateWacAgainstSiblingBranches,
  WAC_ABOVE_PRICE_TOLERANCE,
  WAC_VS_COST_CHAIN_TOLERANCE,
  WAC_SIBLING_BRANCH_TOLERANCE,
} from "@/modules/brain/detectors/wac-health-detector";
import { severityForDeviation } from "@/modules/brain/scoring";

/**
 * docs/WAC-DESACTIVADO.md — auditoría proactiva de salud del WAC.
 * detectWacHealthDecisions hace consultas batch contra prisma real (sin
 * `db` inyectable, mismo motivo que pricing-detector.test.ts) — no hay
 * forma honesta de probar la función completa sin base de datos. Las 3
 * condiciones puras SÍ se pueden probar sin DB, así que son las que llevan
 * el peso de la cobertura acá.
 */

/* ── Regla 1 — VENTA_POR_DEBAJO_DE_WAC ── */

test("un WAC sano (por debajo del precio de venta) no genera nada", () => {
  const result = evaluateWacAgainstSalePrice({ wac: 1500, effectivePrice: 1890 });
  assert.equal(result.isSuspicious, false);
});

test("LA QUE IMPORTA — caso hierro: WAC 2900 contra venta 1890 (~53% de exceso) dispara con severity alta", () => {
  const result = evaluateWacAgainstSalePrice({ wac: 2900, effectivePrice: 1890 });
  assert.equal(result.isSuspicious, true);
  assert.ok(result.excessPercent !== null);
  assert.ok(Math.abs(result.excessPercent! - 0.5344) < 0.001, `excessPercent esperado ~53.4%, obtuvo ${result.excessPercent}`);
  const severity = severityForDeviation(result.excessPercent!, WAC_ABOVE_PRICE_TOLERANCE);
  assert.equal(severity, "HIGH", "53% de exceso sobre un umbral de 15% cae en la banda HIGH (2x-4x el umbral)");
});

test("exceso justo en el umbral (15%) no dispara — estrictamente mayor que, no mayor o igual", () => {
  const result = evaluateWacAgainstSalePrice({ wac: 1150, effectivePrice: 1000 });
  assert.equal(result.isSuspicious, false);
});

test("sin precio efectivo (null), no hay contra qué comparar — no dispara", () => {
  const result = evaluateWacAgainstSalePrice({ wac: 2900, effectivePrice: null });
  assert.equal(result.isSuspicious, false);
  assert.equal(result.excessPercent, null);
});

/* ── Regla 2 — WAC_SE_ALEJA_DEL_COSTO_CHAIN ── */

test("pickCostChainReference: prioriza averageCost sobre globalCost/lastPurchaseCost", () => {
  const result = pickCostChainReference({ averageCost: 18, globalCost: 20, lastPurchaseCost: 22 });
  assert.equal(result.cost, 18);
  assert.equal(result.source, "averageCost");
});

test("pickCostChainReference: sin averageCost, cae a globalCost", () => {
  const result = pickCostChainReference({ averageCost: null, globalCost: 20, lastPurchaseCost: 22 });
  assert.equal(result.cost, 20);
  assert.equal(result.source, "globalCost");
});

test("pickCostChainReference: sin ninguno de los tres, cost=null", () => {
  const result = pickCostChainReference({ averageCost: null, globalCost: null, lastPurchaseCost: null });
  assert.equal(result.cost, null);
  assert.equal(result.source, null);
});

test("un WAC sano (cerca de averageCost) no genera nada", () => {
  const result = evaluateWacAgainstCostChain({ wac: 19, averageCost: 18, globalCost: null, lastPurchaseCost: null });
  assert.equal(result.isSuspicious, false);
});

test("WAC que se desvía 60% de averageCost dispara (arriba del umbral 30%)", () => {
  // 18 * 1.6 = 28.8
  const result = evaluateWacAgainstCostChain({ wac: 28.8, averageCost: 18, globalCost: null, lastPurchaseCost: null });
  assert.equal(result.isSuspicious, true);
  assert.equal(result.referenceSource, "averageCost");
  assert.ok(Math.abs(result.deviationPercent! - 0.6) < 0.001);
});

test("sin ningún costo de referencia, no hay base de comparación — no dispara", () => {
  const result = evaluateWacAgainstCostChain({ wac: 2900, averageCost: null, globalCost: null, lastPurchaseCost: null });
  assert.equal(result.isSuspicious, false);
  assert.equal(result.referenceCost, null);
});

/* ── Regla 3 — WAC_DIFIERE_ENTRE_SUCURSALES_HERMANAS ── */

test("un WAC que difiere 10% entre sucursales (variación normal de compras) NO genera nada", () => {
  // hermana a 100, esta sucursal a 110 -> 10% de desvío, umbral 40%.
  const result = evaluateWacAgainstSiblingBranches({ wac: 110, siblingWacs: [100] });
  assert.equal(result.isSuspicious, false);
});

test("un WAC que difiere 60% entre sucursales SÍ genera", () => {
  const result = evaluateWacAgainstSiblingBranches({ wac: 160, siblingWacs: [100] });
  assert.equal(result.isSuspicious, true);
  assert.ok(Math.abs(result.deviationPercent! - 0.6) < 0.001);
  const severity = severityForDeviation(result.deviationPercent!, WAC_SIBLING_BRANCH_TOLERANCE);
  assert.equal(severity, "MEDIUM", "60% sobre un umbral de 40% no llega a duplicar el umbral (80%) — se queda en MEDIUM");
});

test("compara contra el PROMEDIO de varias hermanas, no contra una sola", () => {
  // hermanas 100 y 200 -> promedio 150. Esta sucursal a 155 -> ~3.3%, no dispara.
  const result = evaluateWacAgainstSiblingBranches({ wac: 155, siblingWacs: [100, 200] });
  assert.equal(result.isSuspicious, false);
  assert.equal(result.siblingAverageWac, 150);
  assert.equal(result.siblingCount, 2);
});

test("sin sucursales hermanas con WAC usable, no hay con qué comparar — no dispara", () => {
  const result = evaluateWacAgainstSiblingBranches({ wac: 2900, siblingWacs: [] });
  assert.equal(result.isSuspicious, false);
  assert.equal(result.siblingCount, 0);
});

test("umbral exacto (40%) no dispara — estrictamente mayor que, no mayor o igual", () => {
  const result = evaluateWacAgainstSiblingBranches({ wac: 140, siblingWacs: [100] });
  assert.equal(result.isSuspicious, false);
});

/* ── Umbrales reusados, no inventados ── */

test("el umbral de la regla 1 es el mismo FACTOR_TOLERANCE (15%) que fix-fusion-canonical-cost.ts", () => {
  assert.equal(WAC_ABOVE_PRICE_TOLERANCE, 0.15);
});

test("los umbrales de las reglas 2 y 3 son más laxos que el de la regla 1, en ese orden", () => {
  assert.ok(WAC_VS_COST_CHAIN_TOLERANCE > WAC_ABOVE_PRICE_TOLERANCE);
  assert.ok(WAC_SIBLING_BRANCH_TOLERANCE > WAC_VS_COST_CHAIN_TOLERANCE);
});
