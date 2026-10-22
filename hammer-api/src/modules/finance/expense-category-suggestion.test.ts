import assert from "node:assert/strict";
import test from "node:test";
import { suggestExpenseCategory, type ExpenseCategorySuggestion } from "@/modules/finance/expense-category-suggestion";

function categoryOf(result: ExpenseCategorySuggestion | null): string | undefined {
  return result && !result.isPurchase ? result.category : undefined;
}

test("pasaje/bus/taxi → Transporte", () => {
  assert.deepEqual(suggestExpenseCategory("pasaje al banco"), { isPurchase: false, category: "TRANSPORT", matchedKeyword: "pasaje" });
  assert.equal(categoryOf(suggestExpenseCategory("bus a Managua")), "TRANSPORT");
  assert.equal(categoryOf(suggestExpenseCategory("taxi del aeropuerto")), "TRANSPORT");
});

test("descarga/ayudante → Carga y descarga", () => {
  assert.equal(categoryOf(suggestExpenseCategory("Ignacio descarga de la mercadería")), "CASUAL_LABOR");
  assert.equal(categoryOf(suggestExpenseCategory("pago a ayudante")), "CASUAL_LABOR");
});

test("desayuno/almuerzo/cena → Alimentación", () => {
  assert.equal(categoryOf(suggestExpenseCategory("Bayardo y Alexander (desayuno)")), "FOOD");
  assert.equal(categoryOf(suggestExpenseCategory("cena para el equipo")), "FOOD");
});

test("bolsa/papel/cloro → Suministros", () => {
  assert.equal(categoryOf(suggestExpenseCategory("bolsas para el mostrador")), "SUPPLIES");
  assert.equal(categoryOf(suggestExpenseCategory("cloro para el baño")), "SUPPLIES");
});

test("arena/bloque/cemento/viaje de material → compra, no gasto", () => {
  assert.deepEqual(suggestExpenseCategory("arena (12 metros)"), { isPurchase: true, matchedKeyword: "arena" });
  assert.equal(suggestExpenseCategory("viaje de arena")?.isPurchase, true);
  assert.equal(suggestExpenseCategory("cemento para el proyecto")?.isPurchase, true);
});

test("'descarga de bloques' es mano de obra (Carga y descarga), no compra, aunque mencione un material — caso real del dueño", () => {
  const result = suggestExpenseCategory("Ignacio descarga de bloques del camión");
  assert.deepEqual(result, { isPurchase: false, category: "CASUAL_LABOR", matchedKeyword: "descarga" });
});

test("sin coincidencia → null", () => {
  assert.equal(suggestExpenseCategory("algo que no coincide con nada"), null);
});

test("normaliza acentos y mayúsculas", () => {
  assert.equal(categoryOf(suggestExpenseCategory("CÉSPED Y BOLSA")), "SUPPLIES");
});
