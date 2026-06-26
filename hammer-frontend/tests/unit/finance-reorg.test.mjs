/**
 * finance-reorg.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * Verifica la reorganización: métricas financieras movidas de Inventario a
 * "Finanzas & Contabilidad". Tests estructurales (leen el código fuente), sin
 * backend ni render — misma convención que critical-files.test.mjs.
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

// ── M.1: Inventario NO renderiza el análisis financiero ──────────────────────
test("M.1 Inventario NO contiene el bloque 'Análisis financiero del inventario'", () => {
  const c = read("components/catalog-inventory/catalog-inventory-admin.tsx");
  assert.ok(!c.includes("Análisis financiero del inventario"), "no debe quedar el título del bloque");
  assert.ok(!c.includes("Ganancia bruta potencial"), "no debe quedar 'Ganancia bruta potencial'");
  assert.ok(!c.includes("Cantidad × precio de venta vigente"), "no debe quedar el detalle de venta potencial");
  // Sí debe quedar el link a Finanzas
  assert.ok(c.includes("/app/master/finance?tab=summary"), "debe enlazar a Finanzas");
});

// ── M.2: Finanzas SÍ renderiza las métricas ──────────────────────────────────
test("M.2 Finanzas SÍ renderiza venta potencial, ganancia bruta, gastos, utilidad operativa", () => {
  const summary = read("components/finance/finance-summary-panel.tsx");
  assert.ok(summary.includes("Valor de venta potencial"), "venta potencial");
  assert.ok(summary.includes("Ganancia bruta potencial"), "ganancia bruta potencial");
  assert.ok(summary.includes("Margen bruto potencial"), "margen bruto potencial");
  assert.ok(summary.includes("Gastos operativos"), "gastos operativos");
  assert.ok(summary.includes("Planilla"), "planilla");
  assert.ok(summary.includes("Utilidad operativa estimada"), "utilidad operativa");
});

// ── M.3 / M.4: Sidebar ───────────────────────────────────────────────────────
test("M.3 Sidebar NO muestra 'Gastos & Precios'", () => {
  const c = read("components/navigation/app-sidebar.tsx");
  assert.ok(!c.includes("Gastos & Precios"), "no debe quedar la etiqueta antigua");
  assert.ok(!c.includes("/app/master/expenses"), "no debe quedar la ruta antigua en el sidebar");
});

test("M.4 Sidebar muestra 'Finanzas & Contabilidad' apuntando a /app/master/finance", () => {
  const c = read("components/navigation/app-sidebar.tsx");
  assert.ok(c.includes("Finanzas & Contabilidad"), "etiqueta nueva");
  assert.ok(c.includes("/app/master/finance"), "ruta nueva");
});

// ── M.5: redirect de compatibilidad ──────────────────────────────────────────
test("M.5 /app/master/expenses redirige a /app/master/finance", () => {
  const c = read("app/app/master/expenses/page.tsx");
  assert.ok(c.includes("redirect"), "usa redirect");
  assert.ok(c.includes("/app/master/finance"), "destino correcto");
});

// ── M.7 / M.8: Gastos y Precios reutilizados dentro de Finanzas ──────────────
test("M.7/M.8 Finanzas reutiliza ExpenseManager para gastos y precios (sin duplicar)", () => {
  const mgr = read("components/finance/finance-accounting-manager.tsx");
  assert.ok(mgr.includes("ExpenseManager"), "reutiliza ExpenseManager");
  assert.ok(mgr.includes('forcedTab="expenses"'), "tab de gastos");
  assert.ok(mgr.includes('forcedTab="pricing"'), "tab de precios");
});

// ── M.9: Planilla solo con permiso ───────────────────────────────────────────
test("M.9 Planilla en Finanzas está gateada por FINANCE_VIEW_PAYROLL", () => {
  const mgr = read("components/finance/finance-accounting-manager.tsx");
  assert.ok(mgr.includes("FINANCE_VIEW_PAYROLL"), "usa la capacidad de planilla");
  assert.ok(mgr.includes("canViewPayroll"), "condiciona el tab de planilla");
});

// ── M.10: Personal & Roles no duplica la pantalla financiera de planilla ─────
test("M.10 Personal & Roles (users) no monta el manager financiero", () => {
  const usersPage = read("app/app/master/users/page.tsx");
  assert.ok(!usersPage.includes("FinanceAccountingManager"), "users no debe montar Finanzas");
  assert.ok(!usersPage.includes("finance-summary-panel"), "users no debe montar el resumen financiero");
});
