import assert from "node:assert/strict";
import test from "node:test";
import { percentile, buildCategoryCalibration } from "@/modules/pricing/calibration-service";

/**
 * Parte C.3 (prompt-completo-pendientes-2026-10.md) — "calibrar con ventas
 * reales": buildCategoryCalibration es pura, se prueba con números a mano.
 */

test("percentile — p50 de un array ordenado", () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 0.5), 30);
});

test("percentile de array vacío da null", () => {
  assert.equal(percentile([], 0.5), null);
});

test("percentile de un solo elemento siempre da ese elemento", () => {
  assert.equal(percentile([42], 0.25), 42);
  assert.equal(percentile([42], 0.75), 42);
});

test("LA QUE IMPORTA — buildCategoryCalibration calcula p25/mediana/p75 SOLO sobre productos con margen realizado usable", () => {
  const row = buildCategoryCalibration({
    categoryId: "cat-1",
    categoryName: "Cemento",
    currentMinMarginPercent: 15,
    currentTargetMarginPercent: 30,
    products: [
      { effectiveMarginPct: 10, realizedMarginPct: 10, units90d: 5 },
      { effectiveMarginPct: 20, realizedMarginPct: 20, units90d: 5 },
      { effectiveMarginPct: 30, realizedMarginPct: 30, units90d: 5 },
      { effectiveMarginPct: 40, realizedMarginPct: 40, units90d: 5 },
      { effectiveMarginPct: 5, realizedMarginPct: null, units90d: 5 }, // sin ventas suficientes — no cuenta para percentiles
    ],
  });
  assert.equal(row.productsWithData, 4, "solo 4 de 5 tienen margen realizado usable");
  assert.equal(row.totalProducts, 5);
  assert.equal(row.realizedMarginMedian, 30, "mediana de [10,20,30,40] con el método de rango más cercano (floor(0.5*4)=índice 2)");
});

test("LA QUE IMPORTA — 'cuántos quedarían en la Bandeja' cuenta por margen EFECTIVO (precio/costo de hoy), no por margen realizado", () => {
  const row = buildCategoryCalibration({
    categoryId: "cat-1",
    categoryName: "Cemento",
    currentMinMarginPercent: 15,
    currentTargetMarginPercent: 30,
    products: [
      { effectiveMarginPct: 5, realizedMarginPct: 25, units90d: 5 }, // vende con margen realizado 25% pero el precio de HOY da 5% — entraría en tray si el umbral > 5
      { effectiveMarginPct: 35, realizedMarginPct: 10, units90d: 5 },
    ],
  });
  assert.equal(row.wouldBeInTrayAtCurrentMin, 1, "solo el de margen efectivo 5% < 15% (mínimo actual)");
});

test("totalUnits90d suma las unidades de TODOS los productos, con o sin margen realizado usable", () => {
  const row = buildCategoryCalibration({
    categoryId: "cat-1",
    categoryName: "Cemento",
    currentMinMarginPercent: 15,
    currentTargetMarginPercent: 30,
    products: [
      { effectiveMarginPct: 10, realizedMarginPct: 10, units90d: 7 },
      { effectiveMarginPct: 5, realizedMarginPct: null, units90d: 3 },
    ],
  });
  assert.equal(row.totalUnits90d, 10);
});

test("categoría sin ningún producto con margen realizado usable da percentiles null, sin reventar", () => {
  const row = buildCategoryCalibration({
    categoryId: "cat-1",
    categoryName: "Cemento",
    currentMinMarginPercent: 15,
    currentTargetMarginPercent: 30,
    products: [{ effectiveMarginPct: 10, realizedMarginPct: null, units90d: 1 }],
  });
  assert.equal(row.realizedMarginP25, null);
  assert.equal(row.realizedMarginMedian, null);
  assert.equal(row.realizedMarginP75, null);
  assert.equal(row.wouldBeInTrayAtP25, 0, "sin p25 no hay nada que contar — no es un umbral real");
});
