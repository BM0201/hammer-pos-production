/**
 * fusion-cost-reconciliation.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * "Eso no esta bien aun le falta, las cosas no se ejecutan bien revisa
 * completo todo" — captura real: "Precios y costos" (RIV) mostraba Costo
 * de compra C$742.14 y margen -14.2% ("Precio bajo costo") para METRO DE
 * ARENA 100P GRANDES, mientras "Fusiones" mostraba Costo global C$470 y
 * margen +20.5% para el MISMO producto. Causa: resolveCostChain (Precios
 * y costos, Brain, POS) prioriza el WAC real de compras SOBRE globalCost
 * — decisión histórica ("el WAC real gana sobre el relleno") — pero
 * Fusiones calculaba costo Y margen SOLO con globalCost, ignorando que el
 * WAC ya lo había superado: un margen que contradecía la realidad.
 *
 * Fix: Fusiones ahora también calcula effectiveCost (resolveCostChain +
 * resolveFusionMemberCost — docs/COSTO-UNA-FUENTE.md, los mismos dos
 * primitivos que usa el resto del motor de precios, con el WAC agregado
 * de todas las sucursales) y calcula el margen con ESE número, no con
 * globalCost — y avisa en la fila cuando difieren, para que editar el
 * costo global de ahí no se sienta como que "no hizo nada".
 *
 * Actualizado (docs/COSTO-UNA-FUENTE.md, Parte B.3/B.5): resolveCatalogDisplayCost
 * se eliminó — era una segunda cascada que no miraba branchCost. Fusiones
 * migró a los primitivos directos (resolveCostChain para el costo del
 * canónico, resolveFusionMemberCost para escalarlo por factor), sin
 * branchId a propósito (Fusiones no tiene selector de sucursal).
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

const PANEL = "components/catalog-inventory/fusion-pricing-panel.tsx";

test("backend: listStockGroups agrega el WAC real de todas las sucursales (aggregateWeightedAverageCost) para el costo efectivo", () => {
  const service = readApi("hammer-api/src/modules/catalog/stock-group-crud.ts");
  assert.ok(service.includes("export function aggregateWeightedAverageCost"));
  assert.ok(service.includes("wacByProductId"), "debe existir el mapa de WAC agregado por producto");
});

test("backend: el costo efectivo de cada miembro usa resolveCostChain + resolveFusionMemberCost (los primitivos de la única resolución de costo), no una cascada propia", () => {
  const service = readApi("hammer-api/src/modules/catalog/stock-group-crud.ts");
  assert.ok(service.includes('import { resolveCostChain, resolveFusionMemberCost } from "@/modules/catalog/effective-pricing"'));
  // La cascada vieja (resolveCatalogDisplayCost, sin branchCost) ya no se
  // importa ni se llama — puede seguir mencionada en comentarios como
  // referencia histórica (docs/COSTO-UNA-FUENTE.md), por eso se chequea la
  // ausencia del import/llamada puntual, no de la palabra en todo el archivo.
  assert.ok(!service.includes('from "@/modules/catalog-inventory/service"'), "ya no debe importar nada de catalog-inventory/service.ts (esa era la cascada vieja)");
  assert.ok(!service.includes("resolveCatalogDisplayCost("), "ya no debe LLAMAR a la cascada vieja");
  assert.ok(service.includes("const effectiveCost ="), "debe calcular el costo efectivo por miembro, separado de globalCost");
});

test("backend: el margen de cada miembro se calcula con effectiveCost, no con globalCost — así nunca contradice a Precios y costos", () => {
  const service = readApi("hammer-api/src/modules/catalog/stock-group-crud.ts");
  assert.match(service, /marginPercent:\s*effectiveCost !== null[\s\S]{0,120}standardSalePrice - effectiveCost/, "el margen debe restar effectiveCost, no globalCost, del precio");
});

test("frontend: FusionPricingMember trae effectiveCost como campo propio, distinto de globalCost", () => {
  const c = read(PANEL);
  assert.ok(c.includes("effectiveCost: number | null"));
});

test("frontend: cuando el costo real (WAC) difiere del costo global editable, la fila lo avisa explícito", () => {
  const c = read(PANEL);
  assert.ok(c.includes("costDivergent"), "debe existir la detección de divergencia entre globalCost y effectiveCost");
  assert.ok(c.includes("Costo real:"), "debe mostrar el costo real como texto, no solo internamente");
});
