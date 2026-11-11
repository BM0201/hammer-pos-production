import assert from "node:assert/strict";
import test from "node:test";
import { countCostEqualsPriceRows, importRowIsInbound, missingQuantityColumnMessage } from "@/modules/catalog-inventory/import-service";

/**
 * D · Fase 3 (prompt-completo-pendientes-2026-10.md) — "Costo igual al
 * precio en N filas: ¿lo cargaste en la columna correcta?", no bloqueante.
 * Pura — reusa suspectCostEqualsPrice (cost-correction-service.ts), no
 * reimplementa el criterio.
 */

test("LA QUE IMPORTA — cuenta las filas con costo = precio exacto", () => {
  const count = countCostEqualsPriceRows([
    { unitCost: 28, standardSalePrice: 28 },
    { unitCost: 40, standardSalePrice: 57.14 },
    { unitCost: null, standardSalePrice: 50 },
  ]);
  assert.equal(count, 1);
});

test("fila sin costo o sin precio no cuenta (nada que comparar)", () => {
  const count = countCostEqualsPriceRows([{ unitCost: null, standardSalePrice: null }, { unitCost: 10, standardSalePrice: null }]);
  assert.equal(count, 0);
});

test("sin ninguna fila dudosa, el conteo es 0", () => {
  const count = countCostEqualsPriceRows([{ unitCost: 10, standardSalePrice: 15 }]);
  assert.equal(count, 0);
});

test("sin columna cantidad: nombra la columna parecida en vez de 'Cantidad invalida.' por fila", () => {
  // Así llegó Catalogo_MGA_actualizado.xlsx (derivado de la exportación del catálogo).
  const msg = missingQuantityColumnMessage(["nombre", "categoria", "unidad", "stock MGA"]);
  assert.match(msg ?? "", /"stock MGA".*renómbrala a "cantidad"/);
  assert.match(missingQuantityColumnMessage(["sku", "nombre"]) ?? "", /Agrégala/);
  assert.equal(missingQuantityColumnMessage(["sku", "Cantidad"]), null);
  assert.equal(missingQuantityColumnMessage(["sku", "stock"]), null);
});

test("entrada que exige costo: cantidad 0 al sumar no mueve nada; el conteo solo cuando sube", () => {
  // Catalogo_MGA_actualizado.xlsx: 1114 filas en 0 + sin columna costo abortaban el lote al ejecutar.
  assert.equal(importRowIsInbound("CATALOG_WITH_INITIAL_STOCK", 0, 0), false);
  assert.equal(importRowIsInbound("CATALOG_WITH_INITIAL_STOCK", 5, 10), true);
  assert.equal(importRowIsInbound("INVENTORY_ADD_STOCK", 3, 0), true);
  assert.equal(importRowIsInbound("PHYSICAL_COUNT_ADJUSTMENT", 12, 10), true);
  assert.equal(importRowIsInbound("PHYSICAL_COUNT_ADJUSTMENT", 8, 10), false);
  assert.equal(importRowIsInbound("CATALOG_ONLY", 5, 0), false);
  assert.equal(importRowIsInbound("CATALOG_WITH_INITIAL_STOCK", undefined, 0), false);
});
