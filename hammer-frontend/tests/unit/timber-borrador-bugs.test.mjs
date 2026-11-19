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

const EDITOR = "components/timber/trip-editor.tsx";

test("BUG 1: el borrador se cancela con el diálogo propio (no confirm() nativo), solo mientras es DRAFT", () => {
  const c = read(EDITOR);
  assert.ok(c.includes("Cancelar borrador"));
  assert.match(c, /\{isEditable && \([\s\S]{0,300}?<button[^\n]*onClick=\{\(\) => setAskCancel\(true\)\}/, "el botón debe estar gateado por isEditable (status DRAFT)");
  assert.ok(c.includes("<ConfirmDialog"), "debe pedir confirmación con el diálogo de la app — es irreversible");
  assert.ok(!c.includes("window.confirm"), "sin confirm() nativo");
  const fnMatch = c.match(/async function cancelTrip\(\)[\s\S]{0,700}?\n  \}/);
  assert.ok(fnMatch, "debe existir la función cancelTrip");
  assert.ok(fnMatch[0].includes('action: "cancel"'), "debe usar la acción ya existente en el backend (PATCH .../trips/{id})");
});

test("BUG 1: listTimberTrips excluye CANCELLED por defecto cuando no se pide un status explícito", () => {
  const trips = readApi("hammer-api/src/modules/timber/trips.ts");
  assert.ok(trips.includes("export async function listTimberTrips"), "debe existir listTimberTrips");
  assert.ok(trips.includes('where.status = { not: "CANCELLED" }'), "sin status pedido, la lista activa no debe incluir viajes cancelados");
  assert.ok(trips.includes("if (filters?.status) {"), "un status pedido explícito (ej. CANCELLED) debe seguir funcionando, sin este default");
});

test("BUG 2: updateTimberTripSchema ya no exige mínimo 1 línea — un DRAFT a medio editar puede legítimamente tener 0", () => {
  const validators = readApi("hammer-api/src/modules/timber/validators.ts");
  const updateStart = validators.indexOf("export const updateTimberTripSchema");
  assert.ok(updateStart !== -1, "debe existir updateTimberTripSchema");
  const updateBlock = validators.slice(updateStart, updateStart + 800);
  assert.ok(!updateBlock.includes(".min(1)"), "updateTimberTripSchema no debe exigir mínimo de líneas");
  assert.ok(readApi("hammer-api/src/modules/timber/injection.ts").includes('throw new Error("TRIP_HAS_NO_LINES")'), "confirmar sin líneas debe seguir rechazado");
});

test("BUG 2: el autoguardado sigue mandando `lines` siempre, incluso vacío", () => {
  assert.ok(read(EDITOR).includes("lines: lines.filter((l) => l.pieces > 0)"), "save() debe mandar lines sin condicionar el envío del campo");
});

test("BUG 3: TOTALES y costo en vivo salen de `lines` (la edición en curso), no del último guardado", () => {
  const cub = read("components/timber/trip-cubication.tsx");
  assert.ok(cub.includes("const totalPieces = lines.reduce"), "totalPieces debe derivarse de `lines`");
  assert.ok(cub.includes("const totalFeet = lines.reduce"), "totalFeet debe derivarse de `lines`");
  assert.ok(!cub.includes("trip.totalPieces"), "la fila TOTALES no debe leer trip.totalPieces");
  const cost = read("components/timber/trip-cost-panel.tsx");
  assert.match(cost, /liveTripCost\(\{\s+lines,/,"el costo de la madera se calcula en vivo desde `lines`");
});

test("el ingreso pide confirmación explícita de la factura: nunca manda acknowledgeReconciliation=true por su cuenta", () => {
  const review = read("components/timber/trip-review.tsx");
  assert.ok(review.includes("acknowledgeReconciliation: reconciliationAcknowledged"), "debe mandar lo que marcó la persona");
  assert.ok(review.includes('type="checkbox"'), "debe haber una casilla para la diferencia con la factura");
});
