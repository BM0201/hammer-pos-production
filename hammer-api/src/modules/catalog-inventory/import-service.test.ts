import assert from "node:assert/strict";
import test from "node:test";
import { countCostEqualsPriceRows } from "@/modules/catalog-inventory/import-service";

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
