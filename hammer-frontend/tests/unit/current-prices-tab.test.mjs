/**
 * current-prices-tab.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * prompt-precios-vigentes-catalogo.md — Parte C: la pestaña "Precios
 * vigentes" en la zona Precios. Tests estructurales (leen el código fuente),
 * sin backend ni render — misma convención que pricing-zone.test.mjs.
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

test("C.1: \"Precios vigentes\" es la segunda pestaña, justo después de Bandeja", () => {
  const p = read(PAGE);
  const tabsBlock = p.slice(p.indexOf("const ZONE_TABS"), p.indexOf("const ZONE_TABS") + 400);
  const trayIdx = tabsBlock.indexOf('label: "Bandeja"');
  const currentIdx = tabsBlock.indexOf('label: "Precios vigentes"');
  const calcIdx = tabsBlock.indexOf('label: "Calculadora"');
  assert.ok(trayIdx > -1 && currentIdx > -1 && calcIdx > -1, "las tres pestañas deben existir");
  assert.ok(trayIdx < currentIdx && currentIdx < calcIdx, "Bandeja, luego Precios vigentes, luego Calculadora — primero lo urgente, después lo completo");
});

test("C.2: la tabla tiene las columnas Producto, Categoría, Costo, Precio, Origen, Margen, Stock", () => {
  const p = read(PAGE);
  for (const col of ["Producto", "Categoría", "Costo", "Precio", "Origen", "Margen", "Stock"]) {
    assert.ok(p.includes(`>${col}</th>`), `debe existir la columna ${col}`);
  }
});

test("C.2: el origen mapea BRANCH→Propio, STANDARD→General, FUSION_DERIVED→Derivado, MISSING→Sin precio", () => {
  const p = read(PAGE);
  assert.ok(/BRANCH:\s*\{\s*label:\s*"Propio"/.test(p));
  assert.ok(/STANDARD:\s*\{\s*label:\s*"General"/.test(p));
  assert.ok(/FUSION_DERIVED:\s*\{\s*label:\s*"Derivado"/.test(p));
  assert.ok(/MISSING:\s*\{\s*label:\s*"Sin precio"/.test(p));
});

test("C.2: margen bajo la política nunca es solo color — el número y el mínimo van al lado", () => {
  const p = read(PAGE);
  const idx = p.indexOf("row.belowPolicy ?");
  assert.ok(idx > -1, "debe existir la rama de margen bajo política");
  const block = p.slice(idx, idx + 700);
  assert.ok(block.includes("fmtPct(row.marginPercent)"), "el número del margen debe estar presente, no solo color");
  assert.ok(block.includes("mín."), "el mínimo de la política debe estar al lado");
});

test("C.3: filtros de categoría, búsqueda (sku o nombre) y origen del precio", () => {
  const p = read(PAGE);
  assert.ok(p.includes('id="current-prices-category"'), "filtro de categoría");
  assert.ok(p.includes('id="current-prices-search"'), "buscador");
  assert.ok(p.includes("toggleSourceChip"), "el origen se filtra con los chips (C.4), un clic responde \"mostrame los que no tienen precio\"");
});

test("C.4: encabezado con desglose por origen en chips que filtran", () => {
  const p = read(PAGE);
  assert.ok(p.includes("data.totals.byPriceSource[source]"), "los chips muestran el conteo por origen");
  assert.ok(p.includes("onClick={() => toggleSourceChip(source)}"), "cada chip filtra al tocarlo");
});

test("C.5: la fila abre la calculadora con ese producto y esa sucursal precargados", () => {
  const p = read(PAGE);
  assert.ok(p.includes("onClick={() => onOpenCalculator(row.productId)}"), "la fila completa debe ser clicable hacia la calculadora");
  assert.ok(/function openCalculatorFor\(productId: string\)/.test(p), "debe existir el handler en el padre");
  const fnIdx = p.indexOf("function openCalculatorFor");
  const fnBlock = p.slice(fnIdx, fnIdx + 400);
  assert.ok(fnBlock.includes('params.set("tab", "calculator")') && fnBlock.includes('params.set("productId", productId)') && fnBlock.includes('params.set("branchId", branchId)'), "debe precargar tab, productId y branchId");
});

test("C.6: el estado vacío nombra los filtros activos y ofrece quitarlos — nunca afirma que no hay productos cuando el filtro no matchea", () => {
  const p = read(PAGE);
  assert.ok(p.includes("function CurrentPricesEmptyState"), "debe existir un estado vacío propio");
  const fnIdx = p.indexOf("function CurrentPricesEmptyState");
  const fnBlock = p.slice(fnIdx, fnIdx + 1600);
  assert.ok(fnBlock.includes("Ningún producto"), "debe nombrar la causa");
  assert.ok(fnBlock.includes("Quitar filtros"), "debe ofrecer quitar filtros");
  assert.ok(fnBlock.includes("if (!hasFilters)"), "sin filtros, es un mensaje distinto (sucursal realmente sin productos), no \"no hay productos\" genérico");
});

test("B.1 (backend): GET /api/master/pricing/current existe, gateado por PRICING_VIEW/isMaster, con branchId obligatorio", () => {
  const abs = resolve(__dirname, "..", "..", "..", "hammer-api", "src", "app", "api", "master", "pricing", "current", "route.ts");
  assert.ok(existsSync(abs), "debe existir hammer-api/src/app/api/master/pricing/current/route.ts");
  const route = readFileSync(abs, "utf8");
  assert.ok(route.includes("CAPABILITIES.PRICING_VIEW"), "mismo guard que la bandeja");
  assert.ok(route.includes('if (!branchId)'), "branchId es obligatorio: sin sucursal no hay precio efectivo");
});

test("B.1 (backend): getCurrentPrices usa effective-pricing.ts para precio Y costo — no una tercera resolución", () => {
  const abs = resolve(__dirname, "..", "..", "..", "hammer-api", "src", "modules", "pricing", "current-prices-service.ts");
  assert.ok(existsSync(abs), "debe existir current-prices-service.ts");
  const service = readFileSync(abs, "utf8");
  // docs/COSTO-UNA-FUENTE.md — resolveCatalogDisplayCostBatch (la cascada
  // de costo de red, sin branchCost) se eliminó entera; getEffectiveProductPricingBatch
  // ya resuelve precio Y costo (branchCost-aware) en una sola llamada.
  assert.ok(service.includes("getEffectiveProductPricingBatch"), "precio y costo: effective-pricing.ts, una sola resolución");
  assert.ok(!service.includes("resolveCatalogDisplayCost"), "la cascada vieja (sin branchCost) ya no debe existir en este archivo");
});
