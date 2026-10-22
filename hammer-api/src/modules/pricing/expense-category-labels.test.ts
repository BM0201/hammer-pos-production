import assert from "node:assert/strict";
import test from "node:test";
import { EXPENSE_CATEGORIES } from "@/modules/pricing/validators";
import { EXPENSE_CATEGORY_LABELS, expenseCategoryLabel } from "@/modules/pricing/expense-category-labels";

test("EXPENSE_CATEGORY_LABELS cubre TODAS las categorías de EXPENSE_CATEGORIES (ni de más, ni de menos)", () => {
  for (const category of EXPENSE_CATEGORIES) {
    const label = EXPENSE_CATEGORY_LABELS[category];
    assert.ok(label, `falta etiqueta en español para "${category}"`);
    assert.notEqual(label, category, `"${category}" no tiene una etiqueta real (muestra el código)`);
  }
  const labelKeys = Object.keys(EXPENSE_CATEGORY_LABELS);
  for (const key of labelKeys) {
    assert.ok((EXPENSE_CATEGORIES as readonly string[]).includes(key), `"${key}" en EXPENSE_CATEGORY_LABELS ya no es una categoría válida`);
  }
});

test("expenseCategoryLabel devuelve la etiqueta en español", () => {
  assert.equal(expenseCategoryLabel("SUPPLIES"), "Suministros");
  assert.equal(expenseCategoryLabel("CASUAL_LABOR"), "Carga y descarga");
  assert.equal(expenseCategoryLabel("BANK_FEES"), "Comisiones bancarias");
});

test("expenseCategoryLabel cae al código solo si de verdad no existe (no debería pasar en la práctica)", () => {
  assert.equal(expenseCategoryLabel("NOT_A_REAL_CATEGORY"), "NOT_A_REAL_CATEGORY");
});
