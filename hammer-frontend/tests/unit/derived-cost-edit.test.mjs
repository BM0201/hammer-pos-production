/**
 * derived-cost-edit.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * "el ultimo costo que se meta es el que gana en las fusiones... con las
 * derivadas y la factorización equivalente al producto se ajuste" — antes,
 * el costo de compra de un miembro DERIVADO de una fusión (ej. "quintal",
 * derivado de "varilla" × 30) era de solo lectura en Precios y costos: el
 * mensaje decía "edítalo en la unidad base", obligando a convertir a mano
 * (780 / 30 = 26) y escribirlo en OTRA fila — exactamente el tipo de
 * conversión manual que originó los datos mal cargados de piedrín y arena
 * esta sesión. Ahora se edita en su propia fila: el backend
 * (resolveGlobalCostWriteTarget, catalog/service.ts) convierte lo
 * escrito por el factor YA VALIDADO de la fusión y lo aplica al canónico
 * — la única fuente real de costo sigue siendo esa, nunca el derivado.
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

test("frontend: el costo de un miembro derivado ya NO es de solo lectura — no queda el mensaje viejo de 'edítalo en la unidad base'", () => {
  const c = read(ADMIN);
  assert.ok(!c.includes("edítalo en la unidad base"), "el mensaje de solo-lectura de antes no debe seguir en el código");
  assert.ok(!/el costo NO se edita ac/.test(c), "el comentario que documentaba el bloqueo viejo debe haberse ido con el bloqueo");
});

test("frontend: la fila de un derivado usa el MISMO input editable que el canónico (onSaveGlobalCost), con título aclarando la conversión", () => {
  const c = read(ADMIN);
  assert.ok(c.includes("se convierte automáticamente al producto canónico"), "debe avisar que lo tecleado se convierte, no se guarda tal cual");
});

test("frontend: globalCostServerValue precarga el input de un derivado con el costo YA convertido a su unidad (row.effectiveCost), no con product.globalCost (siempre null en un derivado)", () => {
  const c = read(ADMIN);
  assert.ok(c.includes("function globalCostServerValue"));
  assert.match(c, /buildBranchPricingCostRow\(product, activeBranch\)/, "debe reusar el mismo motor que ya calcula el costo efectivo de la fila, no reimplementarlo");
});

test("backend: resolveGlobalCostWriteTarget existe y catalog/service.ts la usa en vez de rechazar con assertNotFusionMemberCostWrite", () => {
  const service = readApi("hammer-api/src/modules/catalog/service.ts");
  assert.ok(service.includes("export function resolveGlobalCostWriteTarget"));
  assert.ok(!service.includes("assertNotFusionMemberCostWrite"), "updateProduct ya no debe importar/llamar la guarda vieja — la reemplazó la redirección");
  assert.ok(service.includes("costRedirect"), "updateProduct debe decidir el redirect antes de escribir");
});

test("backend: import-service.ts (Excel) también redirige el costo de un derivado al canónico, en vez de rechazar la fila", () => {
  const importSvc = readApi("hammer-api/src/modules/catalog-inventory/import-service.ts");
  assert.ok(importSvc.includes("resolveGlobalCostWriteTarget"), "debe reusar la misma decisión que catalog/service.ts, no una cuarta implementación");
  assert.ok(!importSvc.includes("assertNotFusionMemberCostWrite"), "ya no debe rechazar la fila sin más");
});
