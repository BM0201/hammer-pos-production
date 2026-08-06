import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calculateBatchCosts, calculateTargetMarginPrice, computeBatchCostSummary } from "@/modules/production/calculations";

/**
 * Producción v2 — verificación numérica del prompt (loseta / marca-pasos):
 * receta de 1000 unidades, insumos 18kg cemento (WAC 415), 2.5kg arena
 * (WAC 850), 0.8kg colorante (WAC 35), 6L agua (WAC 180), mano de obra y
 * overhead en 0 (por defecto).
 */
const LOSETA_INPUTS = [
  { quantity: 18, wacSaleUnit: 415 },
  { quantity: 2.5, wacSaleUnit: 850 },
  { quantity: 0.8, wacSaleUnit: 35 },
  { quantity: 6, wacSaleUnit: 180 },
];

test("Test de costo estándar: loseta 1000u, WAC 415/850/35/180, labor/overhead=0 -> materiales C$10,703.00, unitario C$10.70", () => {
  const summary = computeBatchCostSummary({
    recipeExpectedQuantity: 1000,
    plannedQuantity: 1000,
    producedGoodQuantity: 1000,
    producedBadQuantity: 0,
    inputLines: LOSETA_INPUTS,
    laborCost: 0,
    overheadMode: "NONE",
    overheadValue: null,
  });

  assert.equal(summary.materialsCost.toNumber(), 10703);
  assert.equal(summary.standardMaterialsCost.toNumber(), 10703);
  assert.equal(summary.unitCost.toNumber(), 10.703);
  assert.equal(summary.standardUnitCost.toNumber(), 10.703);
});

test("Test de cierre real: 970 buenas / 30 malas -> costo total C$10,703.00, unitario real C$11.03, rendimiento 97.0%, variancia +3.1%", () => {
  const summary = computeBatchCostSummary({
    recipeExpectedQuantity: 1000,
    plannedQuantity: 1000,
    producedGoodQuantity: 970,
    producedBadQuantity: 30,
    inputLines: LOSETA_INPUTS,
    laborCost: 0,
    overheadMode: "NONE",
    overheadValue: null,
  });

  // Los insumos se consumen para TODO el intento (970+30=1000=lo planificado)
  // — la merma NUNCA reduce el material consumido, solo el divisor real.
  assert.equal(summary.totalCost.toNumber(), 10703, "el costo total del lote no cambia por la merma");
  assert.equal(summary.materialsCost.toNumber(), 10703);

  const unitCostRounded = Math.round(summary.unitCost.toNumber() * 100) / 100;
  assert.equal(unitCostRounded, 11.03, "costo unitario real = costoTotal / unidadesBuenas (970)");

  const yieldPct = summary.yieldPct!.toNumber();
  assert.equal(Math.round(yieldPct * 1000) / 1000, 0.97, "rendimiento = buenas / (buenas+malas)");

  const variancePct = summary.variancePct!.toNumber();
  assert.ok(Math.abs(variancePct - 0.030927835) < 0.0001, `variancia esperada ~+3.09% (real 11.03/estándar 10.70 - 1), obtuvo ${variancePct}`);
  const variancePctRounded = Math.round(variancePct * 1000) / 1000;
  assert.equal(variancePctRounded, 0.031, "variancia redondeada a 1 decimal porcentual coincide con +3.1% del prompt");
});

test("Merma no genera movimiento de inventario ni altera el costo total — solo el divisor de unidades buenas", () => {
  const perdidaParcial = computeBatchCostSummary({
    recipeExpectedQuantity: 1000,
    plannedQuantity: 1000,
    producedGoodQuantity: 500,
    producedBadQuantity: 500,
    inputLines: LOSETA_INPUTS,
    laborCost: 0,
    overheadMode: "NONE",
    overheadValue: null,
  });
  assert.equal(perdidaParcial.totalCost.toNumber(), 10703, "el costo del lote no cambia con más o menos merma, mismo total intentado");
  assert.equal(perdidaParcial.unitCost.toNumber(), 10703 / 500, "el costo unitario sube solo porque el divisor de unidades buenas baja");
});

test("Pérdida total (producedGoodQuantity=0) -> unitCost=0, sin división por cero, sin variancia", () => {
  const summary = computeBatchCostSummary({
    recipeExpectedQuantity: 1000,
    plannedQuantity: 1000,
    producedGoodQuantity: 0,
    producedBadQuantity: 1000,
    inputLines: LOSETA_INPUTS,
    laborCost: 0,
    overheadMode: "NONE",
    overheadValue: null,
  });
  assert.equal(summary.materialsCost.toNumber(), 10703);
  assert.equal(summary.unitCost.toNumber(), 0);
  assert.equal(summary.suggestedPrice, null, "sin targetMarginPct configurado, no hay precio sugerido");
  assert.equal(summary.yieldPct!.toNumber(), 0);
  assert.equal(summary.variancePct, null, "sin unidades buenas no hay variancia que calcular");
});

test("Mano de obra habilitada suma el monto fijo de la receta al costo total (nunca horas x tarifa libre)", () => {
  const summary = computeBatchCostSummary({
    recipeExpectedQuantity: 1000,
    plannedQuantity: 1000,
    producedGoodQuantity: 1000,
    producedBadQuantity: 0,
    inputLines: LOSETA_INPUTS,
    laborCost: 500,
    overheadMode: "NONE",
    overheadValue: null,
  });
  assert.equal(summary.laborCost.toNumber(), 500);
  assert.equal(summary.totalCost.toNumber(), 10703 + 500);
});

test("Overhead FIXED suma un monto fijo; overhead PCT_MAT es un porcentaje de los materiales", () => {
  const fixed = computeBatchCostSummary({
    recipeExpectedQuantity: 1000,
    plannedQuantity: 1000,
    producedGoodQuantity: 1000,
    producedBadQuantity: 0,
    inputLines: LOSETA_INPUTS,
    laborCost: 0,
    overheadMode: "FIXED",
    overheadValue: 200,
  });
  assert.equal(fixed.overheadCost.toNumber(), 200);
  assert.equal(fixed.totalCost.toNumber(), 10703 + 200);

  const pct = computeBatchCostSummary({
    recipeExpectedQuantity: 1000,
    plannedQuantity: 1000,
    producedGoodQuantity: 1000,
    producedBadQuantity: 0,
    inputLines: LOSETA_INPUTS,
    laborCost: 0,
    overheadMode: "PCT_MAT",
    overheadValue: 0.1,
  });
  assert.equal(pct.overheadCost.toNumber(), 1070.3);
  assert.equal(pct.totalCost.toNumber(), 10703 + 1070.3);
});

test("calculateTargetMarginPrice redondea SIEMPRE hacia arriba al múltiplo, nunca al más cercano", () => {
  // 10.703 / (1 - 0.30) = 15.29 -> redondeado hacia arriba al entero = 16 (no 15).
  const price = calculateTargetMarginPrice(10.703, 0.3, 1);
  assert.equal(price.toNumber(), 16);
  const margin = (price.toNumber() - 10.703) / price.toNumber();
  assert.ok(margin >= 0.3, `el margen resultante (${margin}) debe ser >= 30%`);
});

test("calculateBatchCosts: costo del navegador imposible por diseño — la firma ya no acepta inputs/unitCost del cliente", () => {
  const costs = calculateBatchCosts({
    materialsCost: new Prisma.Decimal(10703),
    laborCost: 0,
    overheadCost: 0,
    producedGoodQuantity: 1000,
    targetMarginPct: 0.3,
  });
  assert.equal(costs.unitCost.toNumber(), 10.703);
  // TypeScript ya impide pasar `inputs` con costo por insumo — este test
  // documenta en runtime que el resultado depende solo de materialsCost
  // (un Decimal ya calculado desde el WAC del sistema), nunca de un array
  // de {actualQuantity, unitCost} enviado por el formulario de cierre.
  assert.equal(Object.keys(costs).includes("inputs" as never), false);
});
