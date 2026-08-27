/**
 * pricing-zone.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * prompt-mudanza-zona-precios.md — mudanza de Precios/Políticas desde
 * Gastos/Finanzas a la zona Precios. Tests estructurales (leen el código
 * fuente), sin backend ni render — misma convención que finance-reorg.test.mjs
 * y critical-files.test.mjs. Los items 1-3 de la sección TESTS del prompt
 * (ExpenseManagerTab sin "pricing"/"policies", forcedTab="expenses"/"freight")
 * viven en pricing-zone-fase3.test.mjs — dependen de la Fase 3.
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

// ── Fase 1: extracción sin cambio de comportamiento ──────────────────────────

test("Fase 1.1: los tres paneles de precios existen como archivos propios en components/pricing/", () => {
  assert.ok(existsSync(join(SRC, "components/pricing/pricing-calculator-panel.tsx")), "pricing-calculator-panel.tsx debe existir");
  assert.ok(existsSync(join(SRC, "components/pricing/category-policies-panel.tsx")), "category-policies-panel.tsx debe existir");
  assert.ok(existsSync(join(SRC, "components/pricing/pricing-config-panel.tsx")), "pricing-config-panel.tsx debe existir");
});

// ── Test 4 (prompt): PricingCalculatorPanel con branchId llama a /api/pricing/suggested con ese branchId ──
test("Test 4: PricingCalculatorPanel recibe branchId por props y lo manda en el payload de /api/pricing/suggested", () => {
  const c = read("components/pricing/pricing-calculator-panel.tsx");
  assert.ok(/branchId\s*:\s*string/.test(c), "branchId debe ser prop tipada");
  assert.ok(c.includes('"/api/pricing/suggested"'), "debe llamar a /api/pricing/suggested");
  // El payload arma { branchId, productId, mode, baseCost, ... } — branchId es la
  // sucursal que llega por props, no un selectedBranchId local (eso es lo que
  // separa este panel del estado compartido de Gastos).
  assert.ok(/const payload = \{\s*\n\s*branchId,/.test(c), "el payload de cálculo debe usar branchId (prop) directamente");
  assert.ok(!/\[\s*selectedBranchId/.test(c), "no debe quedar ningún estado selectedBranchId — ese era el compartido con Gastos");
});

test("Fase 1: PricingCalculatorPanel y CategoryPoliciesPanel no importan tipos que ya no necesitan mantener acoplados a Gastos (branchId por props, no branch selector propio duplicando Gastos)", () => {
  const calc = read("components/pricing/pricing-calculator-panel.tsx");
  const pol = read("components/pricing/category-policies-panel.tsx");
  assert.ok(calc.includes("branchId,\n  onSaved,") || /branchId,\s*\n\s*onSaved/.test(calc), "PricingCalculatorPanel recibe branchId/onSaved por props");
  assert.ok(/branchId,?\s*onSaved\s*\}\s*:\s*\{\s*branchId:\s*string/.test(pol.replace(/\s+/g, " ")), "CategoryPoliciesPanel recibe branchId/onSaved por props");
});

test("ExpenseManager ya no define el estado de calculadora/config que se mudó (calcResult, configForm, advancedCalc)", () => {
  const c = read("components/expenses/expense-manager.tsx");
  assert.ok(!c.includes("useState<SuggestedPriceResult"), "calcResult ya no vive en ExpenseManager");
  assert.ok(!c.includes("[configForm, setConfigForm]"), "configForm ya no vive en ExpenseManager");
  assert.ok(!c.includes("[advancedCalc, setAdvancedCalc]"), "advancedCalc ya no vive en ExpenseManager");
  assert.ok(c.includes("PricingCalculatorPanel"), "ExpenseManager sigue mostrando el tab de precios, pero vía el panel mudado");
  assert.ok(c.includes("CategoryPoliciesPanel"), "ExpenseManager sigue mostrando el tab de políticas, pero vía el panel mudado");
});

// ── Fase 2: zona Precios ──────────────────────────────────────────────────────

test("Fase 2.1: la zona Precios tiene cuatro pestañas (Bandeja, Calculadora, Políticas, Configuración) con Bandeja por defecto", () => {
  const p = read("app/app/master/pricing/page.tsx");
  assert.ok(p.includes('label: "Bandeja"'), "pestaña Bandeja");
  assert.ok(p.includes('label: "Calculadora"'), "pestaña Calculadora");
  assert.ok(p.includes('label: "Políticas"'), "pestaña Políticas");
  assert.ok(p.includes('label: "Configuración"'), "pestaña Configuración");
  assert.ok(/rawTab = searchParams\.get\("tab"\) \?\? "tray"/.test(p), "tray (Bandeja) es el default");
});

// ── Test 5 (prompt): "todas las sucursales" muestra el mensaje en las tres pestañas que lo requieren ──
test("Test 5: con sucursal en \"todas\" (branchId vacío), Calculadora/Políticas/Configuración muestran \"Elegí una sucursal para continuar\"", () => {
  const p = read("app/app/master/pricing/page.tsx");
  assert.ok(p.includes("Elegí una sucursal para continuar"), "debe existir el mensaje");
  assert.ok(p.includes('const needsBranch = activeTab !== "tray"'), "solo Bandeja funciona con \"todas\" — las otras tres piden sucursal");
});

test("Fase 2.2: el selector de sucursal es único en el encabezado de la zona (no uno por pestaña)", () => {
  const p = read("app/app/master/pricing/page.tsx");
  const selectorMatches = p.match(/<select className="hm-input w-auto" value=\{branchId\}/g) ?? [];
  assert.equal(selectorMatches.length, 1, "debe haber un solo selector de sucursal a nivel de zona");
});

test("Fase 2.3: el sidebar gatea Precios con PRICING_VIEW || FINANCE_VIEW_PRICING y lo ubica junto a Catálogo e Inventario", () => {
  const c = read("components/navigation/app-sidebar.tsx");
  assert.ok(c.includes("capabilities: [CAPABILITIES.PRICING_VIEW, CAPABILITIES.FINANCE_VIEW_PRICING]"), "dos capabilities — Admin de Sucursal conserva acceso");
  // Debe estar en el mismo bloque de items que Catálogo e Inventario (INVENTARIO & ABASTECIMIENTO), no en COMERCIAL junto a Finanzas.
  const catalogIdx = c.indexOf('label: "Catálogo e Inventario"');
  const pricingIdx = c.indexOf('label: "Precios", icon: Calculator');
  assert.ok(catalogIdx !== -1 && pricingIdx !== -1, "ambos ítems deben existir");
  assert.ok(pricingIdx > catalogIdx && pricingIdx - catalogIdx < 1000, "Precios debe estar inmediatamente después de Catálogo e Inventario, en la misma sección");
});

// ── Test 6 (prompt): la calculadora precarga productId y branchId desde query params ──
test("Test 6: la zona Precios lee productId/branchId de la URL y la calculadora los precarga", () => {
  const p = read("app/app/master/pricing/page.tsx");
  assert.ok(p.includes('searchParams.get("branchId")'), "la zona lee branchId de la URL");
  assert.ok(p.includes('searchParams.get("productId")'), "la zona lee productId de la URL");
  assert.ok(p.includes("initialProductId={initialProductId}"), "se lo pasa a la calculadora");

  const calc = read("components/pricing/pricing-calculator-panel.tsx");
  assert.ok(calc.includes("initialProductId"), "la calculadora acepta initialProductId por props");
  assert.ok(calc.includes("void handleLoadProductContext(initialProductId)"), "precarga el contexto del producto al montar");
});
