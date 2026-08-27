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
  // Fase 3: ya no se muestran acá en absoluto (ni siquiera vía los paneles
  // mudados) — el tab de precios/políticas se retiró de Gastos por completo.
  assert.ok(!c.includes("PricingCalculatorPanel"), "el tab de precios ya no se renderiza en ExpenseManager");
  assert.ok(!c.includes("CategoryPoliciesPanel"), "el tab de políticas ya no se renderiza en ExpenseManager");
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

// ── Fase 3: sacar de donde ya no corresponde ──────────────────────────────────

// Test 1 (prompt): ExpenseManagerTab ya no acepta "pricing" ni "policies" (tipo).
test("Test 1: ExpenseManagerTab ya no acepta \"pricing\" ni \"policies\"", () => {
  const t = read("components/expenses/expense-manager.types.ts");
  assert.ok(t.includes('export type ExpenseManagerTab = "expenses" | "freight";'), "el tipo debe quedar reducido a expenses | freight");
});

// Test 2 (prompt): ExpenseManager con forcedTab="expenses" renderiza gastos igual que antes.
test("Test 2: ExpenseManager con forcedTab=\"expenses\" sigue renderizando Gastos Operativos igual que antes", () => {
  const c = read("components/expenses/expense-manager.tsx");
  assert.ok(c.includes("Registrar Gasto Operativo"), "el formulario de gastos sigue intacto");
  assert.ok(c.includes('activeTab === "expenses"'), "el tab de gastos sigue condicionado igual");
});

// Test 3 (prompt): ExpenseManager con forcedTab="freight" renderiza flete igual que antes.
test("Test 3: ExpenseManager con forcedTab=\"freight\" sigue renderizando Flete interno igual que antes — NO se tocó (nadie pidió moverlo)", () => {
  const c = read("components/expenses/expense-manager.tsx");
  assert.ok(c.includes('activeTab === "freight"'), "el tab de flete sigue condicionado igual");
  assert.ok(c.includes("Configurar ruta") && c.includes("Configurar camion") && c.includes("Crear viaje de flete interno"), "el contenido de flete sigue completo");
});

test("Fase 3.1: ExpenseManager ya no importa ni renderiza los paneles de precios/políticas — ya viven solo en la zona Precios", () => {
  const c = read("components/expenses/expense-manager.tsx");
  assert.ok(!c.includes("PricingCalculatorPanel"), "no debe importar PricingCalculatorPanel");
  assert.ok(!c.includes("CategoryPoliciesPanel"), "no debe importar CategoryPoliciesPanel");
  assert.ok(!c.includes('"pricing"') && !c.includes('"policies"'), "no debe quedar ninguna referencia a los tabs retirados");
});

test("Fase 3.2: FinanceAccountingManager ya no ofrece precios ni políticas por categoría", () => {
  const mgr = read("components/finance/finance-accounting-manager.tsx");
  assert.ok(!mgr.includes('"pricing"') || mgr.includes("RETIRED_TAB_TO_PRICING_ZONE"), "\"pricing\" solo puede aparecer en el mapa de redirección de tabs retirados");
  assert.ok(!/type FinanceTabKey = .*\"pricing\"/.test(mgr), "pricing ya no es un FinanceTabKey válido");
  assert.ok(!/type FinanceTabKey = .*\"config\"/.test(mgr), "config ya no es un FinanceTabKey válido");
});

test("Fase 3.3: FinanceAccountingManager redirige los tabs retirados (?tab=pricing, ?tab=config, ?tab=policies) a la zona Precios", () => {
  const mgr = read("components/finance/finance-accounting-manager.tsx");
  assert.ok(mgr.includes("RETIRED_TAB_TO_PRICING_ZONE"), "debe existir el mapa de redirección");
  assert.ok(mgr.includes("router.replace(`/app/master/pricing?tab=${zoneTab}`"), "debe redirigir a la zona Precios con la pestaña equivalente");
});

// ── Fase 4: enlazar, no duplicar ──────────────────────────────────────────────

test("Fase 4.1: el editor de precio por sucursal en Catálogo (product-360) enlaza a la Calculadora con productId y branchId precargados", () => {
  const c = read("components/catalog-inventory/product-360.tsx");
  assert.ok(c.includes("Calcular precio con costos y margen"), "debe existir el enlace");
  assert.ok(c.includes("/app/master/pricing?tab=calculator&productId=${productId}&branchId=${b.branchId}"), "debe apuntar a la calculadora con productId/branchId de esa fila");
});

test("Fase 4.2: cada fila de la bandeja enlaza a la ficha del producto en Catálogo", () => {
  const p = read("app/app/master/pricing/page.tsx");
  const productLinkMatches = p.match(/href=\{`\/app\/master\/catalog-inventory\/products\/\$\{row\.productId\}`\}/g) ?? [];
  // Debe haber al menos dos: el enlace de toda fila (RowGroup) y el de "Revisar el costo primero" (costLooksWrong).
  assert.ok(productLinkMatches.length >= 2, "toda fila debe enlazar al producto, no solo las de costo dudoso");
});

test("Fase 4.3: docs/PUERTAS-DE-PRECIO.md documenta quién escribe branchPrice, con los caminos reales verificados", () => {
  const abs = join(SRC, "..", "..", "docs", "PUERTAS-DE-PRECIO.md");
  assert.ok(existsSync(abs), "docs/PUERTAS-DE-PRECIO.md debe existir");
  const doc = readFileSync(abs, "utf8");
  assert.ok(doc.includes("setBranchPriceTx"), "debe nombrar el escritor único");
  assert.ok(doc.includes("setBranchPriceInBand") && doc.includes("applyApprovedPriceOverride"), "debe documentar los dos caminos que NO pasan por setBranchPriceTx (hueco real verificado)");
});

test("Fase 3.4: hay un aviso de mudanza (con enlace a Precios) tanto en Gastos como en Finanzas", () => {
  const expenseMgr = read("components/expenses/expense-manager.tsx");
  const financeMgr = read("components/finance/finance-accounting-manager.tsx");
  for (const [name, content] of [["ExpenseManager", expenseMgr], ["FinanceAccountingManager", financeMgr]]) {
    assert.ok(content.includes("se movieron a"), `${name} debe avisar que Precios/Políticas se movieron`);
    assert.ok(content.includes('href={"/app/master/pricing"'), `${name} debe enlazar a la zona Precios`);
  }
});
