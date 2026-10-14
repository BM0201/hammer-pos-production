import assert from "node:assert/strict";
import test from "node:test";
import {
  addOrFocusScannedProduct,
  buildCreateIntakeRequest,
  buildIntakePayloadLines,
  buildPreviewRequestLines,
  canConfirmIntake,
  clearIntakeDraft,
  computeBarCounts,
  draftAgeLabel,
  enforceBranchSelectionForKind,
  loadIntakeDraft,
  quantityForIntakeBranch,
  saveIntakeDraft,
  switchingKindNeedsConfirmation,
  toggleBranchSelection,
  worstRowStatus,
  type DraftStorage,
  type IntakeLine,
  type ScannedProductRef,
} from "@/lib/inventory-intake-logic";

function fakeStorage(): DraftStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
  };
}

function product(overrides: Partial<ScannedProductRef> = {}): ScannedProductRef {
  return { id: "p1", sku: "SKU-1", name: "Cemento", saleUnit: "BOLSA", baseUnit: "BOLSA", hasConversion: false, conversionFactor: 1, ...overrides };
}

function line(overrides: Partial<IntakeLine> = {}): IntakeLine {
  return {
    productId: "p1", sku: "SKU-1", name: "Cemento", saleUnit: "BOLSA", baseUnit: "BOLSA",
    hasConversion: false, conversionFactor: 1, unit: "BOLSA",
    quantity: null, overrides: {}, unitCost: null, salePrice: null,
    ...overrides,
  };
}

// ── estado de la barra (conteos, botón deshabilitado) ─────────────────────

test("LA QUE IMPORTA — estado de la barra: cuenta OK/REVIEW/ERROR y deshabilita confirmar con errores", () => {
  const rows = [
    { productId: "p1", status: "OK" as const },
    { productId: "p2", status: "REVIEW" as const },
    { productId: "p3", status: "ERROR" as const },
  ];
  const counts = computeBarCounts(rows);
  assert.deepEqual(counts, { ok: 1, review: 1, error: 1 });
  assert.equal(canConfirmIntake(counts, rows.length), false, "con 1 error, no se puede confirmar");
  assert.equal(canConfirmIntake({ ok: 2, review: 1, error: 0 }, 3), true, "sin errores, sí se puede");
  assert.equal(canConfirmIntake({ ok: 0, review: 0, error: 0 }, 0), false, "sin ninguna fila, tampoco");
});

test("una fila sin vista previa todavía (ninguna celda resuelta) nunca aparece lista", () => {
  assert.equal(worstRowStatus([]), "ERROR");
  assert.equal(worstRowStatus(["OK", "OK"]), "OK");
  assert.equal(worstRowStatus(["OK", "REVIEW"]), "REVIEW");
  assert.equal(worstRowStatus(["OK", "REVIEW", "ERROR"]), "ERROR");
});

// ── escanear un repetido en Sumar suma y en Conteo enfoca ──────────────────

test("LA QUE IMPORTA — producto nuevo entra con cantidad vacía (nunca 1), sea cual sea el kind", () => {
  const outcome = addOrFocusScannedProduct([], product(), "ADD_STOCK");
  assert.equal(outcome.lines[0].quantity, null);
  assert.equal(outcome.focusProductId, "p1");
});

test("LA QUE IMPORTA — escanear un repetido en Sumar SUMA +1 a 'para todas'", () => {
  const existing = [line({ quantity: 5 })];
  const outcome = addOrFocusScannedProduct(existing, product(), "ADD_STOCK");
  assert.equal(outcome.lines[0].quantity, 6);
  assert.equal(outcome.focusProductId, "p1");
});

test("escanear un repetido en Sumar, sin cantidad previa (vacía), arranca sumando desde 0", () => {
  const existing = [line({ quantity: null })];
  const outcome = addOrFocusScannedProduct(existing, product(), "ADD_STOCK");
  assert.equal(outcome.lines[0].quantity, 1);
});

test("LA QUE IMPORTA — escanear un repetido en Conteo solo ENFOCA, no cambia nada", () => {
  const existing = [line({ quantity: 10 })];
  const outcome = addOrFocusScannedProduct(existing, product(), "PHYSICAL_COUNT");
  assert.equal(outcome.lines[0].quantity, 10, "no se tocó");
  assert.equal(outcome.focusProductId, "p1");
  assert.equal(outcome.lines, existing, "ni siquiera crea un array nuevo");
});

test("escanear un repetido en Carga inicial también solo enfoca (no hay 'otra vez' razonable en una apertura)", () => {
  const existing = [line({ unitCost: 60 })];
  const outcome = addOrFocusScannedProduct(existing, product(), "OPENING_BALANCE");
  assert.equal(outcome.lines[0].unitCost, 60);
  assert.equal(outcome.focusProductId, "p1");
});

// ── cambio de tarjeta con datos pide confirmación ──────────────────────────

test("LA QUE IMPORTA — cambiar de tarjeta con productos ya cargados pide confirmación", () => {
  assert.equal(switchingKindNeedsConfirmation([]), false);
  assert.equal(switchingKindNeedsConfirmation([line()]), true);
});

// ── Conteo fuerza una sucursal ──────────────────────────────────────────────

test("LA QUE IMPORTA — Conteo físico admite una sola sucursal: elegir otra REEMPLAZA, no suma", () => {
  let selected = toggleBranchSelection("PHYSICAL_COUNT", [], "b1");
  assert.deepEqual(selected, ["b1"]);
  selected = toggleBranchSelection("PHYSICAL_COUNT", selected, "b2");
  assert.deepEqual(selected, ["b2"], "b2 reemplaza a b1, no se acumulan");
  selected = toggleBranchSelection("PHYSICAL_COUNT", selected, "b2");
  assert.deepEqual(selected, [], "tocar la misma la deselecciona");
});

test("ADD_STOCK/OPENING_BALANCE sí permiten selección múltiple normal", () => {
  let selected = toggleBranchSelection("ADD_STOCK", [], "b1");
  selected = toggleBranchSelection("ADD_STOCK", selected, "b2");
  assert.deepEqual(selected, ["b1", "b2"]);
});

test("LA QUE IMPORTA — cambiar a Conteo con 2+ sucursales ya elegidas se queda solo con la primera", () => {
  assert.deepEqual(enforceBranchSelectionForKind("PHYSICAL_COUNT", ["b1", "b2", "b3"]), ["b1"]);
  assert.deepEqual(enforceBranchSelectionForKind("ADD_STOCK", ["b1", "b2", "b3"]), ["b1", "b2", "b3"], "en los demás kind no se toca");
});

// ── la cantidad vacía no se manda como 1 / armado del payload por kind ─────

test("LA QUE IMPORTA — una línea sin ningún valor escrito se omite entera (nunca se manda como 1)", () => {
  const lines = [line({ quantity: null }), line({ productId: "p2", quantity: 10 })];
  const payload = buildIntakePayloadLines(lines, ["b1"]);
  assert.equal(payload.length, 1);
  assert.equal(payload[0].productId, "p2");
  assert.equal(payload[0].quantity, 10);
});

test("overrides solo viajan donde el valor difiere de 'para todas'", () => {
  const lines = [line({ quantity: 10, overrides: { b1: 10, b2: 25 } })];
  const payload = buildIntakePayloadLines(lines, ["b1", "b2"]);
  assert.equal(payload[0].quantity, 10);
  assert.deepEqual(payload[0].overrides, { b2: 25 }, "b1 es igual a 'para todas', no necesita override");
});

test("'para todas' vacío pero con un override puntual: esa sucursal SÍ viaja, las demás no se inventan", () => {
  const lines = [line({ quantity: null, overrides: { b1: 12 } })];
  const payload = buildIntakePayloadLines(lines, ["b1", "b2"]);
  assert.equal(payload.length, 1, "la línea tiene algo escrito para b1, no se omite");
  assert.deepEqual(payload[0].overrides, { b1: 12 });
  assert.equal(payload[0].quantity, 0, "el valor de 'para todas' nunca se usa para b2 — b2 queda sin cubrir y su celda marcará ERROR en la vista previa, no 0 silencioso");
});

test("LA QUE IMPORTA — armado del payload por kind: clientRequestId, reason recortado, notes vacías → undefined", () => {
  const body = buildCreateIntakeRequest({
    clientRequestId: "req-1",
    kind: "ADD_STOCK",
    reason: "  Llegó pedido  ",
    notes: "   ",
    branchIds: ["b1"],
    lines: [line({ quantity: 5, unitCost: 100 })],
  });
  assert.equal(body.kind, "ADD_STOCK");
  assert.equal(body.reason, "Llegó pedido");
  assert.equal(body.notes, undefined);
  assert.equal(body.lines[0].unitCost, 100);
});

test("la vista previa SÍ viaja con null (campo vacío) — el servidor decide el estado de esa celda", () => {
  const lines = [line({ quantity: null, overrides: { b1: null, b2: 5 } })];
  const preview = buildPreviewRequestLines(lines);
  assert.equal(preview[0].quantity, null);
  assert.deepEqual(preview[0].overrides, { b1: null, b2: 5 });
});

test("quantityForIntakeBranch respeta null como 'campo vacío', distinto de 0", () => {
  const l = line({ quantity: 5, overrides: { b1: 0 } });
  assert.equal(quantityForIntakeBranch(l, "b1"), 0, "0 es un valor real (conteo que da cero)");
  assert.equal(quantityForIntakeBranch(l, "b2"), 5, "sin override, usa 'para todas'");
});

// ── borrador: guardar y restaurar ──────────────────────────────────────────

test("LA QUE IMPORTA — borrador: guardar y restaurar, por usuario y tipo (no se cruzan)", () => {
  const storage = fakeStorage();
  const draftLines = [line({ quantity: 7 })];
  saveIntakeDraft(storage, "user-1", { kind: "ADD_STOCK", branchIds: ["b1"], reason: "Llegó pedido", notes: "", lines: draftLines });

  const restored = loadIntakeDraft(storage, "user-1", "ADD_STOCK");
  assert.ok(restored);
  assert.equal(restored!.lines[0].quantity, 7);
  assert.equal(restored!.branchIds[0], "b1");

  assert.equal(loadIntakeDraft(storage, "user-1", "PHYSICAL_COUNT"), null, "un borrador de Sumar no aparece bajo Conteo");
  assert.equal(loadIntakeDraft(storage, "user-2", "ADD_STOCK"), null, "ni bajo otro usuario");

  clearIntakeDraft(storage, "user-1", "ADD_STOCK");
  assert.equal(loadIntakeDraft(storage, "user-1", "ADD_STOCK"), null, "clear borra el borrador");
});

test("un storage que tira (cuota, modo privado) nunca rompe guardar/restaurar", () => {
  const throwingStorage: DraftStorage = {
    getItem: () => { throw new Error("no disponible"); },
    setItem: () => { throw new Error("no disponible"); },
    removeItem: () => { throw new Error("no disponible"); },
  };
  assert.doesNotThrow(() => saveIntakeDraft(throwingStorage, "user-1", { kind: "ADD_STOCK", branchIds: [], reason: "", notes: "", lines: [] }));
  assert.equal(loadIntakeDraft(throwingStorage, "user-1", "ADD_STOCK"), null);
  assert.doesNotThrow(() => clearIntakeDraft(throwingStorage, "user-1", "ADD_STOCK"));
});

test("draftAgeLabel: 'hace 2 h' para un borrador de hace 2 horas", () => {
  const savedAt = new Date("2026-01-01T10:00:00.000Z").toISOString();
  const now = new Date("2026-01-01T12:00:00.000Z");
  assert.equal(draftAgeLabel(savedAt, now), "hace 2 h");
});
