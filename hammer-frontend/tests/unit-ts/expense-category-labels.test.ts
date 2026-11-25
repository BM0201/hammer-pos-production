import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORY_LABELS, CATEGORY_ICONS, CATEGORY_COLORS, CATEGORIES } from "@/components/expenses/expense-manager.types";
import { FINANCE_CATEGORY_COLORS } from "@/lib/finance-colors";

/**
 * prompt-caja-gastos-pos-cobro.md Commit 1 — "etiquetas en español en un
 * solo lugar... Prohibido mostrar el código (OTHER, UTILITIES) en
 * cualquier pantalla. Test que recorre el enum y falla si alguna categoría
 * no tiene etiqueta."
 */
test("CATEGORY_LABELS/ICONS/COLORS tienen exactamente las mismas categorías (ni de más, ni de menos)", () => {
  const labelKeys = Object.keys(CATEGORY_LABELS).sort();
  assert.deepEqual(Object.keys(CATEGORY_ICONS).sort(), labelKeys, "CATEGORY_ICONS no coincide con CATEGORY_LABELS");
  assert.deepEqual(Object.keys(CATEGORY_COLORS).sort(), labelKeys, "CATEGORY_COLORS no coincide con CATEGORY_LABELS");
});

test("ninguna etiqueta muestra el código crudo del enum", () => {
  for (const [code, label] of Object.entries(CATEGORY_LABELS)) {
    assert.notEqual(label, code, `"${code}" no tiene una etiqueta en español real`);
  }
});

test("CATEGORIES incluye las categorías nuevas", () => {
  assert.ok(CATEGORIES.includes("SUPPLIES"));
  assert.ok(CATEGORIES.includes("CASUAL_LABOR"));
  assert.ok(CATEGORIES.includes("BANK_FEES"));
});

test("FINANCE_CATEGORY_COLORS (gráfica de Gastos por período) también cubre las categorías nuevas", () => {
  for (const code of CATEGORIES) {
    assert.ok(FINANCE_CATEGORY_COLORS[code], `falta color de gráfica para "${code}"`);
  }
});

test("cada categoría cae en uno de los 4 grupos; equipo y personal del dueño quedan fuera de la operación", async () => {
  const { EXPENSE_GROUP_BY_CATEGORY } = await import("@/components/expenses/expense-manager.types");
  for (const code of CATEGORIES) assert.ok(EXPENSE_GROUP_BY_CATEGORY[code], `"${code}" no tiene grupo`);
  assert.equal(EXPENSE_GROUP_BY_CATEGORY.EQUIPMENT, "OUTSIDE");
  assert.equal(EXPENSE_GROUP_BY_CATEGORY.OWNER_PERSONAL, "OUTSIDE");
  assert.equal(EXPENSE_GROUP_BY_CATEGORY.SUPPLIES, "SUPPLIES");
});
