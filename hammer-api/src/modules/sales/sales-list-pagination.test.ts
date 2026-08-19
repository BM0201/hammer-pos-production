import assert from "node:assert/strict";
import test from "node:test";
import { clampListPage as clampSalesListPage } from "@/modules/sales/service";
import { clampListPage as clampReturnsListPage } from "@/modules/sales-returns/service";

/**
 * Bug 3 (auditoría ventas/pagos/POS): listSaleOrders, listSaleOrdersForManagement
 * (sales/service.ts) y listSaleReturns, listSaleCancellations
 * (sales-returns/service.ts) truncaban en silencio — take fijo, sin forma de
 * pedir la página siguiente. El fix agrega un parámetro page por función,
 * clampeado con clampListPage (mismo patrón ya establecido en
 * inventory/service.ts — clampInventoryMovementPagination, ver
 * movements-pagination.test.ts) y expone hasMore/total en la respuesta.
 *
 * clampListPage y el cálculo de hasMore son puros (sin DB); los efectos de
 * paginación real contra la base (que la página 2 traiga filas distintas a
 * la 1) se cubren en integración/QA manual — mismo criterio que
 * operational-day-open-reopen.test.ts.
 */

for (const [label, clamp] of [
  ["sales/service.ts", clampSalesListPage],
  ["sales-returns/service.ts", clampReturnsListPage],
] as const) {
  test(`${label}: clampListPage(1) es página 1`, () => {
    assert.equal(clamp(1), 1);
  });

  test(`${label}: clampListPage(undefined) por defecto es página 1`, () => {
    assert.equal(clamp(undefined), 1);
  });

  test(`${label}: clampListPage(3) es página 3`, () => {
    assert.equal(clamp(3), 3);
  });

  test(`${label}: clampListPage clampea páginas inválidas (0, negativas, NaN) a 1`, () => {
    assert.equal(clamp(0), 1);
    assert.equal(clamp(-5), 1);
    assert.equal(clamp(Number.NaN), 1);
  });

  test(`${label}: clampListPage trunca decimales`, () => {
    assert.equal(clamp(2.9), 2);
  });
}

// Espejo de "hasMore" — misma fórmula usada en las 4 funciones de listado:
// hasMore = skip + filasDevueltas < total.
function hasMore(skip: number, rowsReturned: number, total: number) {
  return skip + rowsReturned < total;
}

test("bug 3: hasMore es true cuando quedan más filas después de esta página", () => {
  // página 1 de un listado de 250 con take=100: 100 filas devueltas, quedan 150.
  assert.equal(hasMore(0, 100, 250), true);
});

test("bug 3: hasMore es false en la última página exacta", () => {
  // página 3 (skip=200) de 250 con take=100: solo devuelve 50 -> 200+50=250, sin más.
  assert.equal(hasMore(200, 50, 250), false);
});

test("bug 3: pedir la página 2 no repite el skip de la página 1 (trae filas distintas)", () => {
  const take = 100;
  const page1Skip = (clampSalesListPage(1) - 1) * take;
  const page2Skip = (clampSalesListPage(2) - 1) * take;
  assert.equal(page1Skip, 0);
  assert.equal(page2Skip, 100);
  assert.notEqual(page1Skip, page2Skip);
});

test("bug 3: hasMore es false cuando no hay registros (total 0)", () => {
  assert.equal(hasMore(0, 0, 0), false);
});
