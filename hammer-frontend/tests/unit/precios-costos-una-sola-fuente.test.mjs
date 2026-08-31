/**
 * precios-costos-una-sola-fuente.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * prompt-precios-costos-una-sola-fuente.md — el reporte real: LATA en Rivas
 * con costo cargado 25 y precio 36 mostraba margen -9.7% en vez de +30.6%.
 * Dos causas reales, distintas de lo que decía el prompt original:
 *
 *  1. (la más grave) catalog/service.ts (updateProduct) escribía SOLO
 *     globalCost al editar "Costo de compra" — resolveCatalogDisplayCost Y
 *     resolveCostChain priorizan averageCost SOBRE globalCost cuando
 *     averageCost no es null, así que para cualquier producto que alguna
 *     vez recibió una compra real, la edición manual quedaba tapada para
 *     siempre por el averageCost viejo. Ver catalog/service.test.ts.
 *  2. "Precios y costos" (catalog-inventory-admin.tsx) calculaba el margen
 *     con product.baseCost (costo de RED, ignora branchCost) mientras
 *     mostraba branchPrice/branchCost de la sucursal en la misma fila.
 *
 * Tests estructurales (leen el código fuente), sin backend ni render —
 * misma convención que global-cost-package-guard.test.mjs.
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

function readApi(relFromRepoRoot) {
  const abs = resolve(__dirname, "..", "..", "..", relFromRepoRoot);
  assert.ok(existsSync(abs), `Archivo no existe: ${relFromRepoRoot}`);
  return readFileSync(abs, "utf8");
}

const ADMIN = "components/catalog-inventory/catalog-inventory-admin.tsx";

test("backend: updateProduct sincroniza averageCost con globalCost al editar el costo (buildGlobalCostUpdateFields)", () => {
  const service = readApi("hammer-api/src/modules/catalog/service.ts");
  assert.ok(service.includes("export function buildGlobalCostUpdateFields"), "debe existir la función pura, testeable sin DB");
  assert.ok(/averageCost:\s*decimalValue/.test(service), "averageCost debe escribirse al mismo valor que globalCost, no quedar undefined");
  assert.ok(service.includes("...globalCostFields"), "updateProduct debe usar la función extraída, no reimplementar el mapeo inline");
});

test("backend: catalog-inventory getCatalogInventoryCenter reusa getEffectiveProductPricingBatch (el mismo motor que Brain/la Bandeja), no reimplementa una cuarta cascada", () => {
  const service = readApi("hammer-api/src/modules/catalog-inventory/service.ts");
  assert.ok(service.includes("getEffectiveProductPricingBatch"), "debe reusar el motor ya probado de effective-pricing.ts");
  assert.ok(service.includes("branchEffectivePricing"), "debe exponer el campo por sucursal que el frontend necesita");
});

test("frontend: buildBranchPricingCostRow usa branchEffectivePricing (por sucursal), no product.baseCost (costo de red) para el margen", () => {
  const c = read(ADMIN);
  assert.ok(c.includes("product.branchEffectivePricing?.find"), "debe leer el costo/precio efectivo POR SUCURSAL");
  assert.ok(!/effectiveCost = numberOrNull\(product\.baseCost\)/.test(c), "no debe volver a calcular el margen con el costo de red — la causa real del bug reportado");
});

test("frontend: priceSource cae a STANDARD cuando no hay branchPrice — ya no colapsa 'sigue el precio general' en 'Sin precio'", () => {
  const c = read(ADMIN);
  assert.ok(c.includes('"BRANCH" | "STANDARD" | "MISSING" | "FUSION_DERIVED"'), "el tipo debe incluir STANDARD/FUSION_DERIVED, no solo BRANCH|MISSING");
});

test("frontend: isMissing (fila roja / botón Asignar) se decide sobre branchPrice, no sobre effectivePrice", () => {
  const c = read(ADMIN);
  assert.ok(c.includes("const isMissing = row.branchPrice === null"), "con el fallback a STANDARD, effectivePrice casi nunca es null — isMissing tiene que seguir siendo sobre branchPrice para no perder el aviso de 'esta sucursal no tiene precio propio'");
});

test("frontend: cada fila de costo muestra costExplanation (de dónde sale el costo)", () => {
  const c = read(ADMIN);
  assert.ok(c.includes("costExplanation"), "B.3 — un margen que no cuadra tiene que explicarse en la fila, no en una investigación aparte");
  assert.ok(c.includes("function costSourceLabel"), "debe traducir costSource (BRANCH/WAC_ESTIMATE/GLOBAL_AVERAGE/GLOBAL/LAST_PURCHASE/NONE) a texto legible");
});

test("frontend: Parte C — BELOW_COST_NOT_ALLOWED en updateBranchPrice muestra el costo vigente y su origen, no un mensaje genérico", () => {
  const c = read(ADMIN);
  assert.ok(c.includes('raw?.error?.code === "BELOW_COST_NOT_ALLOWED"'), "debe distinguir este código específico");
  assert.ok(/El costo vigente es .*row\.costExplanation/.test(c), "el mensaje debe incluir el costo efectivo Y su explicación, ambos ya calculados en el cliente");
});

test("frontend: Parte C — FUSION_PRICE_OVERRIDE_CONFIRMATION_REQUIRED ofrece reintento con overridePriceConfirmed", () => {
  const c = read(ADMIN);
  assert.ok(c.includes('raw?.error?.code === "FUSION_PRICE_OVERRIDE_CONFIRMATION_REQUIRED"'));
  assert.ok(c.includes("await updateBranchPrice(product, branch, field, value, reason, true)"), "el reintento debe pasar overridePriceConfirmed=true");
  assert.ok(c.includes("overridePriceConfirmed: overridePriceConfirmed || undefined"), "el body del PATCH debe reenviar el override al backend");
});

test("frontend: Parte C — FUSION_COST_WRITE_NOT_ALLOWED tiene mensaje propio en updateBranchPrice y en updateGlobalCost", () => {
  const c = read(ADMIN);
  const matches = c.match(/raw\?\.error\?\.code === "FUSION_COST_WRITE_NOT_ALLOWED"/g) ?? [];
  assert.ok(matches.length >= 2, "debe manejarse en los dos caminos que pueden tocar el costo de un miembro derivado");
});
