import assert from "node:assert/strict";
import test from "node:test";
import { assertPriceNotBelowCost } from "@/modules/pricing/price-guard";

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

test("sin precio en el cambio (undefined): no bloquea — este cambio no toca el precio", () => {
  assert.doesNotThrow(() => assertPriceNotBelowCost({ price: undefined, cost: 100 }));
});
