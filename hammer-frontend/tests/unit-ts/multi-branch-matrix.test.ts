import assert from "node:assert/strict";
import test from "node:test";
import {
  quantityForBranch,
  isOverridden,
  setForAll,
  setOverride,
  resetOverride,
  parseQuantityInput,
  addOrIncrementProduct,
  computeMatrixTotals,
  buildMatrixPayloadLines,
  buildBranchPreviews,
  computeOriginShortfalls,
  parseMatrixTsvPaste,
  type MatrixLine,
} from "@/lib/multi-branch-matrix";

function line(overrides: Partial<MatrixLine> = {}): MatrixLine {
  return { productId: "p1", sku: "SKU-1", name: "Producto 1", cost: 10, forAll: 5, overrides: {}, ...overrides };
}

test("llenar desde 'para todas' — una sucursal sin override toma el valor común", () => {
  const l = line({ forAll: 7 });
  assert.equal(quantityForBranch(l, "branch-1"), 7);
  assert.equal(quantityForBranch(l, "branch-2"), 7);
  assert.equal(isOverridden(l, "branch-1"), false);
});

test("override y '↺' — una sucursal distinta no afecta a las demás, y resetear la vuelve a 'para todas'", () => {
  let l = line({ forAll: 10 });
  l = setOverride(l, "branch-1", 3);
  assert.equal(quantityForBranch(l, "branch-1"), 3);
  assert.equal(quantityForBranch(l, "branch-2"), 10, "branch-2 nunca se tocó, sigue en 'para todas'");
  assert.equal(isOverridden(l, "branch-1"), true);

  l = resetOverride(l, "branch-1");
  assert.equal(quantityForBranch(l, "branch-1"), 10, "↺ vuelve a igualar con 'para todas'");
  assert.equal(isOverridden(l, "branch-1"), false);
});

test("cambiar 'para todas' después de un override no pisa la sucursal distinta", () => {
  let l = line({ forAll: 10 });
  l = setOverride(l, "branch-1", 3);
  l = setForAll(l, 20);
  assert.equal(quantityForBranch(l, "branch-1"), 3, "branch-1 sigue distinta");
  assert.equal(quantityForBranch(l, "branch-2"), 20, "branch-2 sigue al valor común, ya actualizado");
});

test("parseQuantityInput acepta '12' y '=12', rechaza negativos y texto", () => {
  assert.equal(parseQuantityInput("12"), 12);
  assert.equal(parseQuantityInput("=12"), 12);
  assert.equal(parseQuantityInput(" =7 "), 7);
  assert.equal(parseQuantityInput("-1"), null);
  assert.equal(parseQuantityInput("abc"), null);
  assert.equal(parseQuantityInput(""), null);
});

test("LA QUE IMPORTA — escanear un producto repetido suma a 'para todas' en vez de duplicar la fila", () => {
  let lines: MatrixLine[] = [];
  lines = addOrIncrementProduct(lines, { id: "p1", sku: "SKU-1", name: "Producto 1", cost: 10 });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].forAll, 1);

  lines = addOrIncrementProduct(lines, { id: "p1", sku: "SKU-1", name: "Producto 1", cost: 10 });
  assert.equal(lines.length, 1, "sigue siendo una sola fila, no se duplicó");
  assert.equal(lines[0].forAll, 2, "sumó en vez de duplicar");

  lines = addOrIncrementProduct(lines, { id: "p2", sku: "SKU-2", name: "Producto 2", cost: 20 });
  assert.equal(lines.length, 2, "un producto distinto sí agrega fila nueva");
});

test("totales — por sucursal (líneas, unidades, C$) y por producto, solo contando sucursales con cantidad > 0", () => {
  const lines: MatrixLine[] = [
    line({ productId: "p1", forAll: 10, cost: 5 }),
    line({ productId: "p2", forAll: 0, cost: 8, overrides: { "branch-2": 3 } }),
  ];
  const totals = computeMatrixTotals(lines, ["branch-1", "branch-2"]);

  assert.equal(totals.byBranch["branch-1"].lines, 1, "branch-1 solo lleva p1 (p2 quedó en 0 para branch-1)");
  assert.equal(totals.byBranch["branch-1"].units, 10);
  assert.equal(totals.byBranch["branch-1"].amount, 50);

  assert.equal(totals.byBranch["branch-2"].lines, 2, "branch-2 lleva p1 (para todas) y p2 (override)");
  assert.equal(totals.byBranch["branch-2"].units, 13);
  assert.equal(totals.byBranch["branch-2"].amount, 10 * 5 + 3 * 8);

  assert.equal(totals.byProductUnits["p1"], 20, "10 en branch-1 + 10 en branch-2");
  assert.equal(totals.byProductUnits["p2"], 3);
  assert.equal(totals.grandUnits, 23);
});

test("totales — un costo faltante (null) vuelve el monto total null, no 0 ni NaN", () => {
  const lines: MatrixLine[] = [line({ cost: null, forAll: 4 })];
  const totals = computeMatrixTotals(lines, ["branch-1"]);
  assert.equal(totals.byBranch["branch-1"].amount, null);
  assert.equal(totals.grandAmount, null);
  assert.equal(totals.byBranch["branch-1"].units, 4, "las unidades sí se cuentan aunque falte el costo");
});

test("LA QUE IMPORTA — armado del payload: overrides solo donde la sucursal difiere de 'para todas', y solo entre las seleccionadas", () => {
  let l = line({ forAll: 10, cost: 7 });
  l = setOverride(l, "branch-1", 10); // igual al común → no debe aparecer como override
  l = setOverride(l, "branch-2", 3); // distinto → sí aparece
  l = setOverride(l, "branch-9", 99); // sucursal NO seleccionada → se ignora

  const payload = buildMatrixPayloadLines([l], ["branch-1", "branch-2", "branch-3"]);
  assert.equal(payload.length, 1);
  assert.equal(payload[0].quantity, 10);
  assert.equal(payload[0].unitCost, 7);
  assert.deepEqual(payload[0].overrides, { "branch-2": 3 });
});

test("armado del payload: una línea en 0 en TODAS las sucursales seleccionadas no se manda", () => {
  const l = line({ forAll: 0, overrides: {} });
  const payload = buildMatrixPayloadLines([l], ["branch-1", "branch-2"]);
  assert.equal(payload.length, 0);
});

test("LA QUE IMPORTA — vista previa por sucursal: líneas, unidades, monto y 'sin <producto>' cuando una sucursal queda en 0", () => {
  const lines: MatrixLine[] = [
    line({ productId: "p1", name: "Varilla 3/8", forAll: 10, cost: 5, overrides: { "branch-3": 0 } }),
    line({ productId: "p2", name: "Cemento", forAll: 2, cost: 100 }),
  ];
  const previews = buildBranchPreviews(lines, ["branch-1", "branch-3"], { "branch-1": "MGA", "branch-3": "RVS" });

  const mga = previews.find((p) => p.branchId === "branch-1")!;
  assert.equal(mga.linesCount, 2);
  assert.equal(mga.unitsTotal, 12);
  assert.equal(mga.amount, 10 * 5 + 2 * 100);
  assert.deepEqual(mga.skippedProductNames, []);

  const rvs = previews.find((p) => p.branchId === "branch-3")!;
  assert.equal(rvs.linesCount, 1, "RVS no lleva Varilla 3/8 (override a 0)");
  assert.deepEqual(rvs.skippedProductNames, ["Varilla 3/8"]);
});

test("LA QUE IMPORTA — aviso de stock del origen: la SUMA de todos los destinos contra el stock real, no una sucursal a la vez", () => {
  const lines: MatrixLine[] = [line({ productId: "p1", name: "Varilla 3/8", forAll: 10, cost: null })];
  // 3 destinos x 10 = 30, origen solo tiene 25 → falta 5, aunque cada destino individual (10) "parece" alcanzar.
  const shortfalls = computeOriginShortfalls(lines, ["d1", "d2", "d3"], { p1: 25 });
  assert.equal(shortfalls.length, 1);
  assert.equal(shortfalls[0].required, 30);
  assert.equal(shortfalls[0].available, 25);
  assert.equal(shortfalls[0].shortfall, 5);
});

test("aviso de stock del origen: sin faltante no reporta nada", () => {
  const lines: MatrixLine[] = [line({ productId: "p1", forAll: 5, cost: null })];
  const shortfalls = computeOriginShortfalls(lines, ["d1", "d2"], { p1: 100 });
  assert.equal(shortfalls.length, 0);
});

test("LA QUE IMPORTA — interpretar el pegado TSV: código + cantidad para todas, códigos no encontrados se listan aparte", () => {
  const products = [
    { id: "p1", sku: "SKU-1", name: "Producto 1", cost: 10 },
    { id: "p2", sku: "SKU-2", name: "Producto 2", cost: 20 },
  ];
  const text = "Código\tCantidad\nSKU-1\t10\nSKU-2\t5\nSKU-NO-EXISTE\t3";
  const result = parseMatrixTsvPaste(text, products, {});

  assert.equal(result.matched.length, 2);
  assert.equal(result.matched[0].product.id, "p1");
  assert.equal(result.matched[0].forAll, 10);
  assert.equal(result.matched[1].forAll, 5);
  assert.deepEqual(result.unmatchedCodes, ["SKU-NO-EXISTE"]);
});

test("interpretar el pegado TSV: columnas opcionales por sucursal, encabezado con el código de sucursal", () => {
  const products = [{ id: "p1", sku: "SKU-1", name: "Producto 1", cost: 10 }];
  const text = "Código\tCantidad\tMGA\tRVS\nSKU-1\t10\t3\t0";
  const result = parseMatrixTsvPaste(text, products, { MGA: "branch-mga", RVS: "branch-rvs" });

  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].forAll, 10);
  assert.deepEqual(result.matched[0].overrides, { "branch-mga": 3, "branch-rvs": 0 });
});

test("interpretar el pegado TSV: sin fila de encabezado (empieza directo en datos) también funciona", () => {
  const products = [{ id: "p1", sku: "SKU-1", name: "Producto 1", cost: 10 }];
  const text = "SKU-1\t7";
  const result = parseMatrixTsvPaste(text, products, {});
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].forAll, 7);
});
