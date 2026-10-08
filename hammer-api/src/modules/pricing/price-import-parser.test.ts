import assert from "node:assert/strict";
import test from "node:test";
import { parsePriceCell, parsePriceImportMatrix } from "@/modules/pricing/price-import-parser";

test("parsePriceCell — coma de miles, punto decimal: 1,250.50 -> 1250.5", () => {
  assert.equal(parsePriceCell("1,250.50"), 1250.5);
});

test("parsePriceCell — punto de miles, coma decimal: 1.250,50 -> 1250.5", () => {
  assert.equal(parsePriceCell("1.250,50"), 1250.5);
});

test("LA QUE IMPORTA — parsePriceCell — símbolo de moneda + miles sin decimales: 'C$ 1,250' -> 1250, NO 1.25", () => {
  assert.equal(parsePriceCell("C$ 1,250"), 1250);
});

test("parsePriceCell — coma decimal sin miles: 1250,5 -> 1250.5", () => {
  assert.equal(parsePriceCell("1250,5"), 1250.5);
});

test("parsePriceCell — vacío o solo espacios -> null", () => {
  assert.equal(parsePriceCell(""), null);
  assert.equal(parsePriceCell("   "), null);
  assert.equal(parsePriceCell(null), null);
  assert.equal(parsePriceCell(undefined), null);
});

test("LA QUE IMPORTA — parsePriceCell — texto sin ningún dígito -> null, no 0", () => {
  assert.equal(parsePriceCell("abc"), null);
});

test("parsePriceCell — negativo: se parsea el número con signo, el rechazo de negocio es de classifyLine, no de acá", () => {
  assert.equal(parsePriceCell("-150"), -150);
  assert.equal(parsePriceCell("-150.50"), -150.5);
});

test("parsePriceCell — miles con varios grupos: 1,250,000 -> 1250000", () => {
  assert.equal(parsePriceCell("1,250,000"), 1250000);
});

test("parsePriceCell — solo punto decimal, sin coma: 1250.5 -> 1250.5", () => {
  assert.equal(parsePriceCell("1250.5"), 1250.5);
});

test("parsePriceImportMatrix — encabezados por alias, SKU y precio nuevo en cualquier orden de columnas", () => {
  const matrix = [
    ["Nombre", "Código", "Precio Nuevo"],
    ["Cemento gris", "SKU-1", "150.50"],
    ["Clavo 2\"", "SKU-2", "C$ 1,250"],
  ];
  const rows = parsePriceImportMatrix(matrix);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sku, "SKU-1");
  assert.equal(rows[0].newPrice, 150.5);
  assert.equal(rows[0].rowNumber, 2);
  assert.equal(rows[1].sku, "SKU-2");
  assert.equal(rows[1].newPrice, 1250);
});

test("parsePriceImportMatrix — una fila sin SKU ni código de barras se descarta (no hay con qué buscar el producto)", () => {
  const matrix = [
    ["Código", "Precio Nuevo"],
    ["", "100"],
    ["SKU-1", "100"],
  ];
  const rows = parsePriceImportMatrix(matrix);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, "SKU-1");
});

test("parsePriceImportMatrix — solo encabezado, sin filas de datos -> []", () => {
  assert.deepEqual(parsePriceImportMatrix([["SKU", "Precio Nuevo"]]), []);
});
