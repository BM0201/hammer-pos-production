import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { getCategoryColor, withUnclassifiedLast, FINANCE_CATEGORY_COLORS } from "@/lib/finance-colors";

/** prompt-gastos-semana-quincena.md Fase 3 — mapa de colores fijo por categoría. */

describe("getCategoryColor", () => {
  test("devuelve el hex claro u oscuro según el tema", () => {
    assert.equal(getCategoryColor("RENT", "light"), FINANCE_CATEGORY_COLORS.RENT.light);
    assert.equal(getCategoryColor("RENT", "dark"), FINANCE_CATEGORY_COLORS.RENT.dark);
  });

  test("una categoría desconocida cae a un gris neutro, nunca undefined", () => {
    assert.equal(typeof getCategoryColor("NO_EXISTE", "light"), "string");
    assert.ok(getCategoryColor("NO_EXISTE", "light").startsWith("#"));
  });

  test("UNCLASSIFIED es ámbar en ambos temas", () => {
    assert.match(getCategoryColor("UNCLASSIFIED", "light"), /^#(d9|f5)/i);
  });
});

describe("withUnclassifiedLast", () => {
  test("mueve 'Sin clasificar' al final sin tocar el orden de las demás", () => {
    const rows = [
      { category: "UNCLASSIFIED", total: 999 },
      { category: "RENT", total: 100 },
      { category: "FOOD", total: 50 },
    ];
    const sorted = withUnclassifiedLast(rows);
    assert.deepEqual(sorted.map((r) => r.category), ["RENT", "FOOD", "UNCLASSIFIED"]);
  });

  test("sin UNCLASSIFIED, el orden no cambia", () => {
    const rows = [{ category: "RENT", total: 1 }, { category: "FOOD", total: 2 }];
    assert.deepEqual(withUnclassifiedLast(rows), rows);
  });
});
