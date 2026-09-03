/**
 * timber-cubicacion-carga.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * prompt-timber-cubicacion-carga.md. Parte A: STANDARD_MEASURES ampliada a
 * las 54 medidas reales del usuario. Parte B: botón "Cargar cubicación
 * desde Excel" en TripWorkspace, que pide un preview al backend
 * (POST .../cubication-import, sin escribir nada) y aplica el resultado
 * editando `lines` localmente — el mismo autosave/PUT que ya existía
 * guarda el resultado, no hay un camino de escritura nuevo.
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

test("Parte A: STANDARD_MEASURES tiene las 54 medidas reales, no las 10 anteriores", () => {
  const c = read(WORKSPACE);
  const matches = c.match(/\{ thickness: \d+, width: \d+, length: \d+, pieces: 0 \}/g) ?? [];
  assert.equal(matches.length, 54, `debe haber 54 medidas, hay ${matches.length}`);
  // Una de las nuevas (no estaba en la lista vieja de 10, todas de 1"):
  // el thickness=4 (4x4) no existía antes.
  assert.ok(c.includes("{ thickness: 4, width: 4, length: 16, pieces: 0 }"), "debe incluir la medida 4x4x16, nueva en este ciclo");
});

test("Parte B: existe el botón 'Cargar cubicación desde Excel' y acepta solo .xlsx", () => {
  const c = read(WORKSPACE);
  assert.ok(c.includes("Cargar cubicación desde Excel"));
  assert.ok(c.includes('accept=".xlsx"'), "el input de archivo debe restringirse a .xlsx");
  assert.ok(c.includes("onCubicationFileSelected(e.target.files?.[0] ?? null)"), "debe disparar el handler de carga al elegir un archivo");
});

test("Parte B.3: el preview se pide al backend, no se calcula en el cliente", () => {
  const c = read(WORKSPACE);
  assert.ok(c.includes("/api/timber/trips/${tripId}/cubication-import"), "debe llamar al endpoint de preview real");
  assert.ok(c.includes('method: "POST"'));
});

test("Parte B.4: aplicar el import NO llama a un endpoint de escritura nuevo — edita `lines` local y deja que el PUT de siempre lo guarde", () => {
  const c = read(WORKSPACE);
  // applyCubicationImport debe usar setLines (el mismo estado que
  // updateLinePieces/addMeasure/removeLine ya mutan), no un fetch propio.
  const fnMatch = c.match(/function applyCubicationImport\([\s\S]{0,600}?\n  \}/);
  assert.ok(fnMatch, "debe existir applyCubicationImport");
  assert.ok(fnMatch[0].includes("setLines"), "debe mutar el estado local `lines`, no escribir directo a la API");
  assert.ok(!fnMatch[0].includes("apiFetch"), "no debe llamar a la API — el autosave existente se encarga de persistir");
});

test("Parte B.4: medida que ya existe en el viaje se REEMPLAZA (no se suma) — el usuario recuenta de cero", () => {
  const c = read(WORKSPACE);
  const fnMatch = c.match(/function applyCubicationImport\([\s\S]{0,600}?\n  \}/);
  assert.ok(fnMatch, "debe existir applyCubicationImport");
  assert.match(fnMatch[0], /merged\[idx\]\s*=\s*\{\s*\.\.\.merged\[idx\],\s*pieces:\s*item\.pieces\s*\}/, "debe reemplazar pieces, no sumarlo");
});

test("backend: readExcelBuffer/readExcelBase64 aceptan sheetName opcional para pedir la hoja 'Simple' por nombre", () => {
  const service = readApi("hammer-api/src/modules/timber/service.ts");
  assert.ok(service.includes('readExcelBase64(fileBase64, "Simple")'), "debe pedir la hoja Simple, no la primera hoja a ciegas");
  const reader = readApi("hammer-api/src/modules/import-excel/excel-reader.ts");
  assert.ok(reader.includes("sheetName?: string"), "readExcelBuffer debe seguir aceptando el caso sin sheetName (compatibilidad con los llamadores existentes)");
});

test("backend: la columna PIES del archivo nunca se usa — el preview recalcula con calculateBoardFeet", () => {
  const service = readApi("hammer-api/src/modules/timber/service.ts");
  assert.ok(service.includes("calculateBoardFeet({ thickness, width, length })"), "debe reusar la fórmula real, no una copia ni el valor del archivo");
});
