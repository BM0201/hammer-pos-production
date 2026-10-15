import assert from "node:assert/strict";
import test from "node:test";
import {
  canSaveBarcodeEdit,
  removeBarcodeWarningLines,
  isUndoStillAvailable,
  UNDO_WINDOW_MS,
  parseBarcodeConflict,
  countByIssue,
  classifyKeystrokeBurst,
  initCategoryWalk,
  currentCategoryWalkProduct,
  skipCategoryWalk,
  retreatCategoryWalk,
  assignCategoryWalkCode,
  categoryWalkProgress,
  categoryWalkBrandMismatchWarning,
  type CategoryWalkProduct,
} from "@/lib/barcode-manager-logic";

// ── estado de la fila en edición ───────────────────────────────────────────

test("LA QUE IMPORTA — canSaveBarcodeEdit: deshabilitado si vacío o sin cambios", () => {
  const original = { code: "123", kind: "FACTORY" as const };
  assert.equal(canSaveBarcodeEdit(original, { code: "123", kind: "FACTORY" }), false, "sin cambios");
  assert.equal(canSaveBarcodeEdit(original, { code: "   ", kind: "FACTORY" }), false, "vacío tras trim");
  assert.equal(canSaveBarcodeEdit(original, { code: "456", kind: "FACTORY" }), true, "código cambió");
  assert.equal(canSaveBarcodeEdit(original, { code: "123", kind: "SUPPLIER" }), true, "solo el tipo cambió");
});

// ── texto del modal de quitar ──────────────────────────────────────────────

test("LA QUE IMPORTA — removeBarcodeWarningLines según principal/interno/último", () => {
  const secondary = removeBarcodeWarningLines({ isPrimary: false, kind: "FACTORY", nextPrimaryCode: null });
  assert.equal(secondary.length, 1, "secundario, no interno: solo el aviso general");

  const primaryWithNext = removeBarcodeWarningLines({ isPrimary: true, kind: "FACTORY", nextPrimaryCode: "456" });
  assert.ok(primaryWithNext.some((l) => l.includes("456")));

  const lastOne = removeBarcodeWarningLines({ isPrimary: true, kind: "FACTORY", nextPrimaryCode: null });
  assert.ok(lastOne.some((l) => l.includes("sin código")));

  const internal = removeBarcodeWarningLines({ isPrimary: false, kind: "INTERNAL", nextPrimaryCode: null });
  assert.ok(internal.some((l) => l.includes("etiquetas impresas")));
});

// ── temporizador del deshacer ──────────────────────────────────────────────

test("isUndoStillAvailable: disponible antes de los 10s, no después", () => {
  assert.equal(isUndoStillAvailable(1000, 1000 + UNDO_WINDOW_MS - 1), true);
  assert.equal(isUndoStillAvailable(1000, 1000 + UNDO_WINDOW_MS), false);
});

// ── interpretación del 409 ──────────────────────────────────────────────────

test("LA QUE IMPORTA — parseBarcodeConflict extrae el producto dueño de un BARCODE_ALREADY_EXISTS", () => {
  const body = { error: { code: "BARCODE_ALREADY_EXISTS", details: { id: "p1", name: "Producto 1", sku: "SKU-1", barcode: "123", isActive: true } } };
  const conflict = parseBarcodeConflict(body);
  assert.deepEqual(conflict, { id: "p1", name: "Producto 1", sku: "SKU-1", barcode: "123", isActive: true });
});

test("parseBarcodeConflict: cualquier otro error da null", () => {
  assert.equal(parseBarcodeConflict({ error: { code: "VALIDATION_ERROR", message: "x" } }), null);
  assert.equal(parseBarcodeConflict(null), null);
  assert.equal(parseBarcodeConflict({}), null);
});

// ── filtros de problemas ────────────────────────────────────────────────────

test("countByIssue suma cada issue, una fila puede contar para varios", () => {
  const counts = countByIssue([
    { issues: ["CHECKSUM_INVALID"] },
    { issues: ["CHECKSUM_INVALID", "PRODUCT_INACTIVE"] },
    { issues: [] },
  ]);
  assert.equal(counts.CHECKSUM_INVALID, 2);
  assert.equal(counts.PRODUCT_INACTIVE, 1);
  assert.equal(counts.MULTIPLE_CODES, 0);
});

// ── atajo de dígito contra escaneo del lector ───────────────────────────────

test("LA QUE IMPORTA — un solo dígito, campo vacío: es atajo", () => {
  const result = classifyKeystrokeBurst({ keystrokes: [{ key: "3", timestampMs: 0 }], fieldWasEmptyAtStart: true });
  assert.equal(result, "SHORTCUT");
});

test("LA QUE IMPORTA — dos teclas en la ventana de 120ms: es un escaneo, no un atajo", () => {
  const result = classifyKeystrokeBurst({ keystrokes: [{ key: "3", timestampMs: 0 }, { key: "0", timestampMs: 30 }], fieldWasEmptyAtStart: true });
  assert.equal(result, "NOT_SHORTCUT");
});

test("campo NO vacío: nunca es atajo, aunque llegue un solo dígito", () => {
  const result = classifyKeystrokeBurst({ keystrokes: [{ key: "3", timestampMs: 0 }], fieldWasEmptyAtStart: false });
  assert.equal(result, "NOT_SHORTCUT");
});

test("una tecla que no es 1-5 ni 'n' no es un atajo válido", () => {
  const result = classifyKeystrokeBurst({ keystrokes: [{ key: "x", timestampMs: 0 }], fieldWasEmptyAtStart: true });
  assert.equal(result, "NOT_SHORTCUT");
});

// ── modo "Recorrer por categoría" ────────────────────────────────────────────

function walkProducts(): CategoryWalkProduct[] {
  return [
    { productId: "p1", name: "Producto bajo stock", sku: "SKU-1", stockInBranch: 2 },
    { productId: "p2", name: "Producto alto stock", sku: "SKU-2", stockInBranch: 50 },
    { productId: "p3", name: "Producto medio", sku: "SKU-3", stockInBranch: 10 },
  ];
}

test("LA QUE IMPORTA — initCategoryWalk ordena por stock primero", () => {
  const state = initCategoryWalk(walkProducts());
  assert.equal(currentCategoryWalkProduct(state)!.productId, "p2");
});

test("LA QUE IMPORTA — asignar al resaltado lo marca hecho y avanza al siguiente", () => {
  let state = initCategoryWalk(walkProducts());
  const first = currentCategoryWalkProduct(state)!;
  state = assignCategoryWalkCode(state);
  assert.ok(state.doneProductIds.includes(first.productId));
  assert.notEqual(currentCategoryWalkProduct(state)!.productId, first.productId);
  assert.deepEqual(categoryWalkProgress(state), { done: 1, total: 3 });
});

test("saltar avanza SIN marcar hecho; volver retrocede", () => {
  let state = initCategoryWalk(walkProducts());
  const first = currentCategoryWalkProduct(state)!;
  state = skipCategoryWalk(state);
  assert.equal(state.doneProductIds.length, 0, "saltar no marca hecho");
  assert.notEqual(currentCategoryWalkProduct(state)!.productId, first.productId);
  state = retreatCategoryWalk(state);
  assert.equal(currentCategoryWalkProduct(state)!.productId, first.productId);
});

test("saltar en el último se queda en el último (no se sale de rango)", () => {
  let state = initCategoryWalk(walkProducts());
  state = skipCategoryWalk(skipCategoryWalk(skipCategoryWalk(state)));
  assert.equal(state.currentIndex, 2);
});

test("volver en el primero se queda en el primero", () => {
  const state = retreatCategoryWalk(initCategoryWalk(walkProducts()));
  assert.equal(state.currentIndex, 0);
});

// ── aviso de otra marca ──────────────────────────────────────────────────────

test("LA QUE IMPORTA — categoryWalkBrandMismatchWarning: avisa si hay señal de fabricante y el resaltado no es parte de ella", () => {
  const warning = categoryWalkBrandMismatchWarning("highlighted", "Pintura XYZ", [
    { productId: "otro", reasons: [{ code: "SAME_MANUFACTURER" }] },
  ]);
  assert.ok(warning?.includes("Pintura XYZ"));
});

test("categoryWalkBrandMismatchWarning: no avisa si el resaltado SÍ coincide por fabricante", () => {
  const warning = categoryWalkBrandMismatchWarning("highlighted", "Pintura XYZ", [
    { productId: "highlighted", reasons: [{ code: "SAME_MANUFACTURER" }] },
  ]);
  assert.equal(warning, null);
});

test("categoryWalkBrandMismatchWarning: sin ninguna señal de fabricante, no hay base para dudar", () => {
  const warning = categoryWalkBrandMismatchWarning("highlighted", "Pintura XYZ", [{ productId: "otro", reasons: [{ code: "SIMILAR_NAME" }] }]);
  assert.equal(warning, null);
});
