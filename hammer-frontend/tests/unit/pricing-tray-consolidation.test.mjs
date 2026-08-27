/**
 * pricing-tray-consolidation.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * prompt-zona-precios-consolidacion.md — Partes A/B/C: el encabezado de la
 * bandeja de precios ya no puede afirmar que nada necesita revisión estando
 * filtrada, los filtros tienen etiqueta y ancho correcto, y el estado vacío
 * nombra la causa y ofrece salidas. Tests estructurales (leen el código
 * fuente), sin backend ni render — misma convención que pricing-zone.test.mjs.
 *
 * Ejecutar: npm run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "..", "src");

function read(rel) {
  const abs = join(SRC, rel);
  assert.ok(existsSync(abs), `Archivo no existe: ${rel}`);
  return readFileSync(abs, "utf8");
}

const PAGE = "app/app/master/pricing/page.tsx";

// ── Test 5 (prompt): con filtros activos y cero resultados, NO se renderiza "Nada necesita revisión ahora mismo" ──
test("Test 5: \"Nada necesita revisión ahora mismo\" cuelga de unfilteredTotals.count === 0, no de totals.count", () => {
  const p = read(PAGE);
  assert.ok(p.includes("data.unfilteredTotals.count === 0 ? ("), "el primer estado del encabezado debe chequear unfilteredTotals");
  // La frase debe estar DENTRO de esa rama, no ligada directamente a totals.count === 0 en ningún otro punto del archivo.
  const idx = p.indexOf("Nada necesita revisión ahora mismo");
  assert.ok(idx > -1, "la frase debe seguir existiendo, para el caso realmente vacío");
  const before = p.slice(Math.max(0, idx - 200), idx);
  assert.ok(before.includes("data.unfilteredTotals.count === 0"), "la frase debe estar condicionada por unfilteredTotals, no por totals filtrado");
});

// ── Test 6 (prompt): "Quitar filtros" aparece solo con filtros activos y los limpia ──
test("Test 6: \"Quitar filtros\" solo se renderiza con hasFilters, y limpia sucursal + categoría + motivo", () => {
  const p = read(PAGE);
  assert.ok(p.includes("{hasFilters && (\n          <Button type=\"button\" variant=\"ghost\" size=\"sm\" onClick={clearFilters}>Quitar filtros</Button>"), "el botón debe estar gateado por hasFilters");
  assert.ok(/const clearFilters = \(\) => \{\s*\n\s*onClearBranch\(\);\s*\n\s*setCategoryFilter\(""\);\s*\n\s*setReasonFilter\(""\);/.test(p), "clearFilters debe limpiar los tres estados (sucursal vía onClearBranch, categoría, motivo)");
  assert.ok(/const hasFilters = !!branchId \|\| !!categoryFilter \|\| !!reasonFilter/.test(p), "hasFilters debe incluir la sucursal — es el filtro invisible de la captura");
});

// ── Test 7 (prompt): los tres selects tienen label asociado (htmlFor / id) ──
test("Test 7: los tres selects (Sucursal, Categoría, Motivo) tienen <label htmlFor> con id correspondiente", () => {
  const p = read(PAGE);
  const pairs = [
    ["pricing-zone-branch", "Sucursal"],
    ["pricing-tray-category", "Categoría"],
    ["pricing-tray-reason", "Motivo"],
  ];
  for (const [id, labelText] of pairs) {
    assert.ok(p.includes(`htmlFor="${id}"`), `debe existir <label htmlFor="${id}">`);
    assert.ok(p.includes(`id="${id}"`), `debe existir el select con id="${id}"`);
    const labelIdx = p.indexOf(`htmlFor="${id}"`);
    const nearby = p.slice(labelIdx, labelIdx + 120);
    assert.ok(nearby.includes(labelText), `la etiqueta cerca de ${id} debe decir "${labelText}"`);
  }
});

test("Parte B.1: el ancho de los tres selects vive en el contenedor (w-[...]), no en el select — .hm-input es width:100% en globals.css", () => {
  const p = read(PAGE);
  assert.ok(!p.includes('"hm-input w-auto"'), "no debe quedar ningún hm-input w-auto — ese ancho no funciona (globals.css gana)");
  assert.ok(/className="w-\[\d+px\]"/.test(p), "el ancho debe estar en un div contenedor");
});

// ── Test 8 (prompt): con unfilteredTotals.count === 0 no se renderiza "Ver los N" ──
test("Test 8: EmptyTrayState no ofrece \"Ver los N\" cuando unfilteredCount es 0 — ahí el catálogo está sano de verdad", () => {
  const p = read(PAGE);
  const fnStart = p.indexOf("function EmptyTrayState(");
  assert.ok(fnStart > -1, "debe existir EmptyTrayState");
  const earlyReturnIdx = p.indexOf("if (unfilteredCount === 0)", fnStart);
  assert.ok(earlyReturnIdx > -1 && earlyReturnIdx < fnStart + 900, "debe haber un camino temprano específico para catálogo sano");
  const nextBranchIdx = p.indexOf("// C.1 —", earlyReturnIdx); // el próximo comentario marca el final de esta rama
  const earlyReturnBlock = p.slice(earlyReturnIdx, nextBranchIdx > -1 ? nextBranchIdx : earlyReturnIdx + 700);
  assert.ok(!earlyReturnBlock.includes("Ver los"), "el camino de catálogo sano no debe ofrecer \"Ver los N\"");
  assert.ok(earlyReturnBlock.includes("Calcular un precio"), "sí debe ofrecer Calcular un precio");
});

test("Parte C.1: el estado vacío nombra la causa (sucursal/categoría/motivo activos)", () => {
  const p = read(PAGE);
  assert.ok(p.includes("Ningún producto"), "debe nombrar la causa cuando hay filtros");
  assert.ok(p.includes("REASON_PREDICATE"), "debe usar un predicado propio para \"tiene {motivo}\" (no el título de sección)");
});

test("Parte C.3: hay una fila de chips por motivo (más costo dudoso) con el conteo SIN FILTRAR, que navega al tocarlos", () => {
  const p = read(PAGE);
  assert.ok(p.includes("Ver por motivo:"), "debe existir la fila de chips");
  assert.ok(p.includes("data.unfilteredTotals.byReason[group.key]"), "el conteo de cada chip debe ser el sin filtrar");
  assert.ok(p.includes("setReasonFilter(group.key)"), "cada chip debe aplicar su filtro al tocarlo");
});

test("Parte D (ya no aplica en este prompt): la zona sigue siendo la de la mudanza anterior — bandeja + calculadora + políticas + configuración, sin volver a extraer nada", () => {
  const p = read(PAGE);
  assert.ok(p.includes("PricingCalculatorPanel") && p.includes("CategoryPoliciesPanel") && p.includes("PricingConfigPanel"), "las cuatro pestañas ya existían — este prompt no las vuelve a construir");
  const expenseMgr = read("components/expenses/expense-manager.tsx");
  assert.ok(!expenseMgr.includes("PricingCalculatorPanel"), "Gastos ya no las muestra desde el ciclo anterior — nada que hacer acá");
});
