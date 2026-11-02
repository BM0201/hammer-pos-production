import assert from "node:assert/strict";
import test from "node:test";
import { productTextSearchSql } from "./inventory-list-service";

test("productTextSearchSql: sin texto no filtra", () => {
  assert.equal(productTextSearchSql(undefined), null);
  assert.equal(productTextSearchSql("   "), null);
});

test("productTextSearchSql: cada palabra es su propia condición (AND), no la frase pegada", () => {
  const sql = productTextSearchSql("plywood 3/16")!;
  assert.equal(sql.sql.match(/p\.name ILIKE/g)?.length, 2);
  assert.ok(sql.values.includes("%PLYWOOD%"));
  assert.ok(sql.values.includes("%3/16%"));
  assert.ok(!sql.values.includes("%PLYWOOD 3/16%"));
  assert.match(sql.sql, /"ProductBarcode"/);
  // Mismos campos que la Lista (buildProductSearchWhere incluye category.name): si no, "Ver los N resultados" no cuadra.
  assert.match(sql.sql, /"Category" sc/);
});
