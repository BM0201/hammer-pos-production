import assert from "node:assert/strict";
import test from "node:test";
import { assertPriceNotBelowCost, assertNotFusionMemberCostWrite } from "@/modules/pricing/price-guard";

/**
 * Auditoría 2026-07-22 (ALTO Catálogo): faltaba el bloqueo de "precio bajo
 * costo" en 3 de 5 caminos de edición (producto global, precio inline por
 * sucursal, importación Excel) — un precio C$80 con costo C$100 se guardaba
 * sin ningún aviso, dejando el producto vendiéndose con pérdida silenciosa.
 */
test("precio por debajo del costo: bloquea (C$80 precio vs C$100 costo)", () => {
  assert.throws(
    () => assertPriceNotBelowCost({ price: 80, cost: 100 }),
    /BELOW_COST_NOT_ALLOWED/,
  );
});

test("precio igual al costo: permitido (margen cero, no es pérdida)", () => {
  assert.doesNotThrow(() => assertPriceNotBelowCost({ price: 100, cost: 100 }));
});

test("precio por encima del costo: permitido", () => {
  assert.doesNotThrow(() => assertPriceNotBelowCost({ price: 120, cost: 100 }));
});

test("sin costo conocido (null): no bloquea — no hay con qué comparar", () => {
  assert.doesNotThrow(() => assertPriceNotBelowCost({ price: 50, cost: null }));
});

test("costo cero: no bloquea (evita falsos positivos de productos con costo 0 en tránsito)", () => {
  assert.doesNotThrow(() => assertPriceNotBelowCost({ price: 50, cost: 0 }));
});

/**
 * Bug reportado (captura de Precios y costos, RIV): un producto que vive de
 * precios por sucursal tiene standardSalePrice=0 (nunca configurado — el
 * precio real está en BranchProductSetting.branchPrice, que este guard no
 * ve). Al editar SOLO el costo de compra (globalCost) desde updateProduct,
 * `assertPriceNotBelowCost({ price: 0, cost: <cualquier costo positivo> })`
 * bloqueaba SIEMPRE — 0 < cualquier costo positivo. Mismo criterio que
 * "costo cero" de arriba, aplicado al otro operando.
 */
test("precio cero: no bloquea (producto que vive de precio por sucursal — standardSalePrice nunca configurado, no un precio real de C$0)", () => {
  assert.doesNotThrow(() => assertPriceNotBelowCost({ price: 0, cost: 55 }));
});

test("precio negativo: tampoco bloquea — mismo criterio que precio 0, no hay con qué comparar", () => {
  assert.doesNotThrow(() => assertPriceNotBelowCost({ price: -1, cost: 55 }));
});

test("sin precio en el cambio (undefined): no bloquea — este cambio no toca el precio", () => {
  assert.doesNotThrow(() => assertPriceNotBelowCost({ price: undefined, cost: 100 }));
});

/**
 * prompt-costos-precios-fusion.md §2.1/§5 prueba 4 — "Intento de guardar un
 * costo sobre un miembro derivado → se rechaza indicando que va en el
 * canónico". Sin excepción: ni edición de producto ni importación Excel
 * pueden escribir costo en un miembro derivado.
 */
test("miembro derivado de una fusión (isCanonical=false): rechaza el intento de cargar costo", () => {
  assert.throws(
    () => assertNotFusionMemberCostWrite({ isCanonical: false }),
    /FUSION_COST_WRITE_NOT_ALLOWED/,
  );
});

test("canónico (isCanonical=true): permite cargar costo — es la base legítima de la fusión", () => {
  assert.doesNotThrow(() => assertNotFusionMemberCostWrite({ isCanonical: true }));
});

test("producto sin fusión (conversion=null): permite cargar costo con normalidad", () => {
  assert.doesNotThrow(() => assertNotFusionMemberCostWrite(null));
});
