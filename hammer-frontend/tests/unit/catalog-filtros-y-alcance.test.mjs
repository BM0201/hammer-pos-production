/**
 * catalog-filtros-y-alcance.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * docs/COSTO-UNA-FUENTE.md, ciclo de blindaje — dos cosas que este prompt
 * pedía cerrar en catalog-inventory-admin.tsx: la barra de filtros dejó de
 * apilarse (Parte A), y "Todas las sucursales" dejó de mostrar costos de
 * una sucursal arbitraria (Parte B/C).
 *
 * Tests estructurales (leen el código fuente), sin backend ni render —
 * misma convención que fusion-cost-reconciliation.test.mjs.
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

const ADMIN = "components/catalog-inventory/catalog-inventory-admin.tsx";

test("Parte A: la barra de filtros no usa .hm-input directo sin envolver — cada control en su propio div con ancho fijo", () => {
  const c = read(ADMIN);
  // El bug: .hm-input declara width:100% (globals.css), así que un select
  // sin envolver ocupa la fila entera. La barra de filtros ahora envuelve
  // buscar/sucursal/categoría cada uno en su propio div w-[NNNpx].
  assert.match(c, /<div className="w-\[190px\]">\s*<label htmlFor="cat-branch"/, "sucursal envuelta en div de ancho fijo, con label");
  assert.match(c, /<div className="w-\[170px\]">\s*<label htmlFor="cat-category"/, "categoría envuelta en div de ancho fijo, con label");
});

test("Parte A.2: los 2 selects de la barra de filtros tienen label real (htmlFor/id)", () => {
  const c = read(ADMIN);
  assert.ok(c.includes('id="cat-branch"'), "select de sucursal debe tener id");
  assert.ok(c.includes('htmlFor="cat-branch"'), "debe existir un label asociado a cat-branch");
  assert.ok(c.includes('id="cat-category"'), "select de categoría debe tener id");
  assert.ok(c.includes('htmlFor="cat-category"'), "debe existir un label asociado a cat-category");
});

test("Parte A.3: sin botón Aplicar en la barra de filtros — branchId/categoryId ya disparan recarga sola", () => {
  const c = read(ADMIN);
  const barraFiltros = c.slice(c.indexOf("Barra de filtros"), c.indexOf("Tabs — subrayado"));
  assert.ok(!barraFiltros.includes(">Aplicar<"), "el botón Aplicar debe haberse eliminado de la barra de filtros");
});

test("Parte B (backend): getCatalogInventoryCenter ya no cae a branches[0] — resolveCostScope no tiene ese fallback", () => {
  const service = readFileSync(resolve(__dirname, "..", "..", "..", "hammer-api", "src", "modules", "catalog-inventory", "service.ts"), "utf8");
  assert.ok(!service.includes("branches[0]?.id ?? null"), "el fallback viejo (costBranchId = params.branchId ?? branches[0]?.id ?? null) no debe existir más");
  assert.ok(service.includes("export function resolveCostScope"), "debe existir resolveCostScope, pura y exportada para test");
  assert.ok(service.includes('const { costBranchId, costScope, costBranchName } = resolveCostScope('), "getCatalogInventoryCenter debe llamar a la función real, no reimplementar la lógica");
});

test("Parte C.1/C.3: el frontend renombró baseCost a effectiveCost y agrega costScope/costBranchId/costBranchName al tipo de respuesta", () => {
  const c = read(ADMIN);
  assert.ok(!c.includes("baseCost: number"), "el campo viejo (siempre-número, sin scope) no debe existir en el tipo ProductRow");
  assert.ok(c.includes("effectiveCost: number | null"), "ProductRow debe declarar effectiveCost como nullable");
  assert.ok(c.includes('costScope: "BRANCH" | "NETWORK"'), "CenterData debe declarar costScope");
  assert.ok(c.includes("costBranchId: string | null"), "CenterData debe declarar costBranchId");
});

test("Parte C.1: las celdas de costo/precio de la tabla de Productos usan formatCostOrDash — '—', no 'C$0.00' ni 'N/D'", () => {
  const c = read(ADMIN);
  assert.ok(c.includes("function formatCostOrDash"), "debe existir el formateador dedicado (guion, no N/D)");
  assert.match(c, /formatCostOrDash\(value: number \| null\)[\s\S]{0,80}value === null \? "—"/, "sin valor, formatCostOrDash debe devolver el guion, nunca N/D ni 0");
  // Las celdas de la tabla de Productos deben usar el formateador nuevo.
  assert.ok(c.includes("formatCostOrDash(product.effectiveCost)"), "la celda de Costo debe leer product.effectiveCost con formatCostOrDash");
  assert.ok(c.includes("formatCostOrDash(rowEffectivePrice)"), "la celda de Precio debe usar el mismo formateador");
});

test("Parte C.1: el encabezado de las columnas de costo/precio trae un tooltip cuando costScope es NETWORK", () => {
  const c = read(ADMIN);
  assert.ok(c.includes("Elegí una sucursal para ver costos y precios"), "debe existir el tooltip exacto pedido");
});

test("Parte C.2: aviso de alcance de red — una línea de texto, no una alerta ámbar", () => {
  const c = read(ADMIN);
  assert.ok(c.includes("Mostrando existencias de todas las sucursales"), "debe existir el aviso cuando costScope es NETWORK");
  assert.ok(c.includes("Los costos y precios dependen de la sucursal"), "debe explicar por qué costo/precio no se muestran");
});

test("Parte C.3: con sucursal elegida, el encabezado de columna dice 'Costo · {código}' — mismo patrón que Precios y costos", () => {
  const c = read(ADMIN);
  assert.match(c, /Costo\{data\.costScope === "BRANCH" && costBranchCode \? ` · \$\{costBranchCode\}` : ""\}/, "el encabezado de Costo debe incluir el código de sucursal cuando hay una elegida");
});

test("Parte C.4: 'Precios y costos' (PricingPanel) ya no cae a branches[0] en silencio — activeBranch es null sin sucursal, no un fallback local", () => {
  const c = read(ADMIN);
  assert.ok(!c.includes("branches.find((branch) => branch.id === selectedBranchId) ?? branches[0]"), "activeBranch no debe caer a branches[0]");
  assert.ok(c.includes("branches.find((branch) => branch.id === selectedBranchId) ?? null"), "activeBranch debe ser null explícito sin sucursal elegida");
  assert.ok(!c.includes("if (!selectedBranchId && branches[0]) {"), "no debe existir el useEffect que auto-seleccionaba branches[0] y mutaba el branchId compartido");
  assert.ok(c.includes("Elegí una sucursal arriba para ver y editar precios y costos"), "debe pedir explícito una sucursal en vez de mostrar la tabla vacía en silencio");
});
