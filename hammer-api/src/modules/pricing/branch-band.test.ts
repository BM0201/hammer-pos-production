import assert from "node:assert/strict";
import test from "node:test";
import { decidePriceBandPath } from "@/modules/pricing/branch-band-service";

/**
 * Fase 4 (prompt-motor-precios-lote-herencia-gobierno.md) — la sucursal
 * ajusta libre DENTRO de la banda de su categoría; solo sale a aprobación
 * lo que se pasa. decidePriceBandPath es la decisión pura (sin DB) —
 * setBranchPriceInBand (el wrapper que llama a getEffectiveProductPricing/
 * resolvePolicyForProduct/prisma.$transaction/approvalService.createRequest,
 * todo contra prisma real) no es probable sin base de datos, mismo límite
 * de siempre en este módulo.
 */

test("Prueba 11 — margen sobre el mínimo → dentro de la banda (se aplicaría directo, sin solicitud)", () => {
  const result = decidePriceBandPath({ price: 150, cost: 100, minMarginPercent: 20 });
  // margen real: (150-100)/150 = 33.3%, por encima del 20% mínimo
  assert.equal(result.inBand, true);
  assert.ok(Math.abs(result.marginPercent - 33.33) < 0.01);
});

test("Prueba 12 (LA QUE IMPORTA) — margen bajo el mínimo → NO dentro de la banda (saldría a solicitud de aprobación)", () => {
  const result = decidePriceBandPath({ price: 105, cost: 100, minMarginPercent: 20 });
  // margen real: (105-100)/105 = 4.76%, muy por debajo del 20% mínimo
  assert.equal(result.inBand, false);
  assert.ok(result.marginPercent < 20);
});

test("margen EXACTAMENTE en el mínimo cuenta como dentro de la banda (>=, no >)", () => {
  // precio tal que el margen sea exactamente 20%: price = cost / (1 - 0.20)
  const price = 100 / 0.8;
  const result = decidePriceBandPath({ price, cost: 100, minMarginPercent: 20 });
  assert.equal(result.inBand, true);
});

test("Prueba 13 — sin costo conocido (política sin resolver a un costo real) usa el default virtual y no revienta: se trata como dentro de la banda", () => {
  // resolvePolicyForProduct ya devuelve el default virtual (minMarginPercent
  // del schema, 15) cuando no hay BranchCategoryPricingPolicy configurada —
  // acá se prueba que decidePriceBandPath no revienta con ese valor típico,
  // ni con costo null (producto sin costo cargado todavía).
  const withDefaultPolicy = decidePriceBandPath({ price: 100, cost: 60, minMarginPercent: 15 });
  assert.equal(withDefaultPolicy.inBand, true);

  const withoutCost = decidePriceBandPath({ price: 100, cost: null, minMarginPercent: 15 });
  assert.equal(withoutCost.inBand, true, "sin costo no hay margen que comparar contra la banda — no bloquea a una sucursal sin costo cargado");

  const withZeroCost = decidePriceBandPath({ price: 100, cost: 0, minMarginPercent: 15 });
  assert.equal(withZeroCost.inBand, true, "costo 0 se trata igual que costo desconocido, no como margen 100%");
});
