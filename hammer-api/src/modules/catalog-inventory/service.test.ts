import assert from "node:assert/strict";
import test from "node:test";
import { computeHasNoPrice } from "@/modules/catalog-inventory/service";

/**
 * Parte A (prompt-precios-vigentes-catalogo.md) — ESTE ES EL TEST QUE
 * IMPORTA: Array.every sobre un arreglo vacío da true, así que un producto
 * SIN ninguna fila BranchProductSetting (el caso normal: sigue el precio
 * general en todas las sucursales) quedaba marcado "sin precio". La
 * condición vieja tampoco miraba standardSalePrice — el precio general que
 * effective-pricing.ts resuelve como STANDARD.
 */

test("Test 1 (LA QUE IMPORTA) — standardSalePrice > 0 y CERO BranchProductSetting → hasNoPrice false", () => {
  assert.equal(computeHasNoPrice(100, []), false, "sigue el precio general — no está sin precio");
});

test("Test 2 — sin standardSalePrice y sin ningún branchPrice → hasNoPrice true", () => {
  assert.equal(computeHasNoPrice(0, [0, 0]), true);
  assert.equal(computeHasNoPrice(0, []), true, "también sin ninguna fila de sucursal");
});

test("Test 3 — sin standardSalePrice pero con branchPrice en una sucursal → hasNoPrice false", () => {
  assert.equal(computeHasNoPrice(0, [0, 150, 0]), false, "una sola sucursal con precio propio alcanza");
});

test("standardSalePrice > 0 Y branchPrice en alguna sucursal → sigue false (caso normal doble)", () => {
  assert.equal(computeHasNoPrice(100, [0, 90]), false);
});
