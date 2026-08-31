/**
 * fusion-member-name-edit.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * "Se edita la pantalla el nombre, pero eso no debe inferir bajo ningun
 * aspecto nada de lo relacionado con el motor" — el reclamo real no era un
 * bug de acoplamiento (nombre → motor de cálculo): no existe ningún camino
 * donde editar Product.name cambie automáticamente conversionFactor/
 * saleUnit de una fusión. Era que corregir UNA presentación mal cargada
 * (el caso real: "220 Paladas" con nombre Y factor equivocados) exigía ir
 * a DOS pantallas — Catálogo para el nombre, Fusión para la unidad/factor.
 * Ahora "Editar presentaciones" (EditMembersModal) también deja corregir el
 * nombre ahí mismo, con su propio PATCH a /api/catalog/products/{id},
 * completamente separado del PUT de /api/inventory/stock-groups/{id} — dos
 * endpoints, dos campos, sin mezclarse. El asistente de CREAR una fusión
 * (FusionCreateWizard, otro llamador del mismo FusionMemberRow) no ofrece
 * esto a propósito — ahí se agregan productos que ya existen en el
 * catálogo, renombrar no es parte de ese flujo.
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

const FUSION = "components/inventory/inventory-fusion-manager.tsx";

test("FusionMemberRow acepta onNameChange opcional y renderiza un input cuando se pasa", () => {
  const c = read(FUSION);
  assert.ok(c.includes("onNameChange?: (value: string) => void;"), "debe ser opcional — el asistente de creación no lo usa");
  assert.match(c, /onNameChange \? \(/, "debe ramificar entre input editable y el label estático de siempre");
});

test("EditMembersModal (Editar presentaciones, la pantalla que reportó el usuario) pasa onNameChange — el asistente de creación NO", () => {
  const c = read(FUSION);
  const editModalIdx = c.indexOf("function EditMembersModal");
  const wizardIdx = c.indexOf("function FusionCreateWizard");
  assert.ok(editModalIdx > -1 && wizardIdx > -1 && editModalIdx > wizardIdx, "EditMembersModal viene después del wizard en el archivo");
  const editModalSlice = c.slice(editModalIdx);
  const wizardSlice = c.slice(wizardIdx, editModalIdx);
  assert.ok(editModalSlice.includes("onNameChange={(value) => updateName(m.productId, value)}"), "Editar presentaciones debe ofrecer renombrar");
  assert.ok(!wizardSlice.includes("onNameChange="), "el asistente de creación no debe ofrecerlo — ahí se agregan productos ya existentes, no se renombran");
});

test("el nombre se guarda con SU PROPIO PATCH a /api/catalog/products/{id} — no viaja en el PUT de /api/inventory/stock-groups/{id}", () => {
  const c = read(FUSION);
  const editModalIdx = c.indexOf("function EditMembersModal");
  const saveIdx = c.indexOf("async function save()", editModalIdx);
  const saveBody = c.slice(saveIdx, saveIdx + 3000);
  assert.ok(saveBody.includes("apiFetch(`/api/catalog/products/${m.productId}`"), "debe reusar el endpoint de edición de producto ya existente, no inventar uno nuevo");
  assert.match(saveBody, /body: JSON\.stringify\(\{ name: m\.name\.trim\(\) \}\)/, "el PATCH de nombre debe mandar SOLO name — nada de conversionFactor/saleUnit mezclado ahí");
  assert.ok(saveBody.includes("method: \"PUT\""), "el PUT de stock-groups sigue existiendo por separado, para saleUnit/conversionFactor");
});

test("un fallo al renombrar no bloquea guardar la unidad/factor — son independientes", () => {
  const c = read(FUSION);
  const editModalIdx = c.indexOf("function EditMembersModal");
  const saveBody = c.slice(editModalIdx, editModalIdx + 4500);
  assert.ok(/No corta acá/.test(saveBody) || saveBody.includes("renameFailures.length > 0"), "debe seguir hacia el PUT aunque el rename falle");
});

test("nombre vacío se rechaza antes de guardar nada (mismo criterio que unit/factor)", () => {
  const c = read(FUSION);
  const editModalIdx = c.indexOf("function EditMembersModal");
  const saveIdx = c.indexOf("async function save()", editModalIdx);
  const saveBody = c.slice(editModalIdx, saveIdx + 1500);
  assert.ok(saveBody.includes("!m.name.trim()"), "debe validar que el nombre no quede vacío");
});
