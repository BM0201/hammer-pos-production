/**
 * timber-borrador-bugs.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * prompt-timber-borrador-bugs.md — tres bugs relacionados en el flujo de
 * edición de un TimberTrip DRAFT:
 *   BUG 1: no había forma de cancelar/eliminar un borrador desde la interfaz.
 *   BUG 2: el autoguardado mandaba lines:[] y el backend lo rechazaba con 400.
 *   BUG 3: la fila TOTALES leía el último guardado exitoso (trip.totalPieces/
 *          totalFeet) mientras el resto de la pantalla ya mostraba la edición
 *          en curso (`lines`) — desincronizados cuando el guardado fallaba o tardaba.
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

function readApi(relFromRepoRoot) {
  const abs = resolve(__dirname, "..", "..", "..", relFromRepoRoot);
  assert.ok(existsSync(abs), `Archivo no existe: ${relFromRepoRoot}`);
  return readFileSync(abs, "utf8");
}

const WORKSPACE = "components/timber/timber-workspace.tsx";

test("BUG 1: existe un botón 'Cancelar viaje' visible solo cuando trip.status es DRAFT, con confirm() antes de mandar la acción", () => {
  const c = read(WORKSPACE);
  assert.ok(c.includes("Cancelar viaje"));
  assert.match(c, /trip\.status === "DRAFT" && \(\s*<Button variant="danger"[\s\S]{0,80}onClick=\{cancelTrip\}/, "el botón debe estar gateado por status DRAFT");
  const fnMatch = c.match(/async function cancelTrip\(\)[\s\S]{0,700}?\n  \}/);
  assert.ok(fnMatch, "debe existir la función cancelTrip");
  assert.ok(fnMatch[0].includes("window.confirm"), "debe confirmar antes de cancelar — es irreversible");
  assert.ok(fnMatch[0].includes('action: "cancel"'), "debe usar la acción ya existente en el backend (PATCH .../trips/{id})");
});

test("BUG 1: listTimberTrips excluye CANCELLED por defecto cuando no se pide un status explícito", () => {
  const service = readApi("hammer-api/src/modules/timber/service.ts");
  assert.ok(service.includes("export async function listTimberTrips"), "debe existir listTimberTrips");
  assert.ok(service.includes('where.status = { not: "CANCELLED" }'), "sin status pedido, la lista activa no debe incluir viajes cancelados");
  assert.ok(service.includes("if (filters?.status) {"), "un status pedido explícito (ej. CANCELLED) debe seguir funcionando, sin este default");
});

test("BUG 2: updateTimberTripSchema ya no exige mínimo 1 línea — un DRAFT a medio editar puede legítimamente tener 0", () => {
  const validators = readApi("hammer-api/src/modules/timber/validators.ts");
  const updateStart = validators.indexOf("export const updateTimberTripSchema");
  const createStart = validators.indexOf("export const createTimberTripSchema");
  assert.ok(updateStart !== -1, "debe existir updateTimberTripSchema");
  assert.ok(createStart !== -1, "debe existir createTimberTripSchema");
  const updateBlock = validators.slice(updateStart, updateStart + 800);
  const createBlock = validators.slice(createStart, createStart + 800);
  assert.ok(!updateBlock.includes(".min(1)"), "updateTimberTripSchema no debe exigir mínimo de líneas");
  assert.ok(createBlock.includes(".min(1"), "createTimberTripSchema SÍ debe seguir exigiendo al menos 1 línea al crear — el límite se movió, no se borró");
});

test("BUG 2: el autoguardado del frontend sigue mandando `lines` siempre, incluso vacío — el fix es del lado del backend, no un parche para evitar mandar el campo", () => {
  const c = read(WORKSPACE);
  assert.ok(c.includes("lines: lines.filter((l) => l.pieces > 0)"), "save() debe seguir mandando lines tal cual, sin condicionar el envío del campo");
});

test("BUG 3: la fila TOTALES de Cubicación se calcula desde `lines` (la edición en curso), no desde trip.totalPieces/totalFeet (el último guardado)", () => {
  const c = read(WORKSPACE);
  const stepMatch = c.match(/function StepViajeYCubicacion\([\s\S]*?\n\/\* ── Paso 2/);
  assert.ok(stepMatch, "debe existir StepViajeYCubicacion");
  const body = stepMatch[0];
  assert.ok(body.includes("const totalPieces = lines.reduce"), "totalPieces debe derivarse de `lines`");
  assert.ok(body.includes("const totalFeet = lines.reduce"), "totalFeet debe derivarse de `lines`, no de trip.totalFeet");
  assert.ok(!body.includes("{trip.totalPieces}"), "la fila TOTALES ya no debe leer trip.totalPieces directo");
  // La sección "Madera (pies × precio)" tiene el mismo problema — misma corrección.
  assert.ok(body.includes("Madera ({fmt(totalFeet)} × {fmt(computedCostPerFoot)})"), "la sección Madera debe usar los valores en vivo, no trip.computedCostPerFoot");
});

test("BUG 3: StepCostosPorMedida (paso 2, revisión de costos ya calculados) SIGUE leyendo trip.lines/trip.total* — es una pantalla de solo-lectura sobre el último guardado, no un editor en vivo", () => {
  const c = read(WORKSPACE);
  const stepMatch = c.match(/function StepCostosPorMedida\([\s\S]*?\n\/\* ── Paso 3/);
  assert.ok(stepMatch, "debe existir StepCostosPorMedida");
  assert.ok(stepMatch[0].includes("{trip.totalPieces}"), "este paso SÍ debe seguir mostrando el último cálculo guardado — no se tocó a propósito, es una revisión, no un editor");
});
