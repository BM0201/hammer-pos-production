/**
 * global-cost-package-guard.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * "asegura el motor de mejor manera" (segundo bug de precios/costos
 * reportado) — updateGlobalCost (Precios y costos) ofrece el reintento con
 * allowHighUnitCost cuando el backend sospecha que se tecleó el costo del
 * BULTO como si fuera el costo de la unidad base (SUSPECTED_PACKAGE_COST_
 * AS_UNIT_COST) — sin esto, un costo alto legítimo (el bulto de verdad subió)
 * quedaría bloqueado sin salida, el mismo tipo de callejón que ya se arregló
 * para standardSalePrice. Tests estructurales (leen el código fuente), sin
 * backend ni render — misma convención que pricing-zone.test.mjs.
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

test("updateGlobalCost ofrece reintento con allowHighUnitCost cuando el backend sospecha costo de bulto", () => {
  const c = read(ADMIN);
  assert.ok(c.includes('raw?.error?.code === "SUSPECTED_PACKAGE_COST_AS_UNIT_COST"'), "debe detectar el código específico, no el genérico VALIDATION_ERROR");
  assert.ok(c.includes("await updateGlobalCost(product, value, true)"), "el reintento debe pasar allowHighUnitCost=true");
});

test("el body del PATCH manda allowHighUnitCost al backend", () => {
  const c = read(ADMIN);
  assert.ok(c.includes("allowHighUnitCost: allowHighUnitCost || undefined"), "debe reenviar el override en el payload");
});

test("backend: updateProductSchema acepta allowHighUnitCost", () => {
  const validators = readApi("hammer-api/src/modules/catalog/validators.ts");
  assert.ok(/allowHighUnitCost:\s*z\.boolean\(\)\.optional\(\)/.test(validators));
});

test("backend: updateProduct aplica el guard solo al canónico de un grupo con factor >= 4, usando maxPackageFactorForSanityCheck", () => {
  const service = readApi("hammer-api/src/modules/catalog/service.ts");
  assert.ok(service.includes("maxPackageFactorForSanityCheck"), "debe reusar la lógica ya probada de wac.ts, no reimplementarla");
  assert.ok(service.includes("conversion?.isCanonical"), "solo aplica al canónico — un derivado ya tiene bloqueada la escritura de costo por otro guard");
  assert.ok(service.includes("detectPackageCostAsUnitCost"), "debe reusar el guard existente de movimientos de inventario, no uno nuevo");
});

test("backend: la ruta PATCH /api/catalog/products/[id] mapea WacValidationError con su propio code (no el VALIDATION_ERROR genérico)", () => {
  const route = readApi("hammer-api/src/app/api/catalog/products/[id]/route.ts");
  assert.ok(route.includes("error instanceof WacValidationError"));
  assert.ok(/fail\(error\.code, error\.message, 422\)/.test(route), "usa error.code (específico) para que el frontend pueda distinguirlo del resto de validaciones");
});
