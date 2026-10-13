import assert from "node:assert/strict";
import test from "node:test";
import { severityForMargin } from "@/modules/brain/scoring";

/**
 * Parte C.3 (prompt-completo-pendientes-2026-10.md) — "nada fijo en el
 * código": severityForMargin pasó de thresholds fijos (10/20) a relativos
 * al mínimo de LA SUCURSAL/categoría. Con minMarginPercent=15 (el default
 * de siempre), el comportamiento es IDÉNTICO al viejo 10/20 — mitad de 15
 * es 7.5, no 10, así que estos números confirman el cambio de escala, no
 * solo "sigue dando lo mismo".
 */

test("LA QUE IMPORTA — margen negativo siempre es CRITICAL, sin importar el mínimo", () => {
  assert.equal(severityForMargin(-5, 15), "CRITICAL");
  assert.equal(severityForMargin(-5, 30), "CRITICAL");
});

test("LA QUE IMPORTA — por debajo de la MITAD del mínimo de la sucursal es HIGH", () => {
  assert.equal(severityForMargin(7, 15), "HIGH", "7% < 7.5% (mitad de 15%)");
  assert.equal(severityForMargin(14, 30), "HIGH", "14% < 15% (mitad de 30%)");
});

test("LA QUE IMPORTA — por debajo del mínimo (pero no de su mitad) es MEDIUM", () => {
  assert.equal(severityForMargin(10, 15), "MEDIUM", "10% < 15% pero >= 7.5%");
  assert.equal(severityForMargin(20, 30), "MEDIUM", "20% < 30% pero >= 15%");
});

test("en o por encima del mínimo de la sucursal es LOW", () => {
  assert.equal(severityForMargin(15, 15), "LOW");
  assert.equal(severityForMargin(35, 30), "LOW");
});

test("LA QUE IMPORTA — la escala se mueve con el mínimo configurado, no con un número fijo en el código", () => {
  // Una sucursal con mínimo 5% (ferretería de bajo margen): 6% ya es LOW, no HIGH como con el viejo umbral fijo de 10.
  assert.equal(severityForMargin(6, 5), "LOW");
  // Una sucursal con mínimo 50% (categoría de alto margen): 20% sigue siendo CRÍTICO en términos relativos (HIGH), aunque el viejo umbral fijo lo hubiera marcado MEDIUM (< 20).
  assert.equal(severityForMargin(20, 50), "HIGH", "20% < 25% (mitad de 50%)");
});
