import assert from "node:assert/strict";
import test from "node:test";
import {
  addOrFocusScannedProduct,
  applyBranchCellInput,
  applySalePriceCellInput,
  buildCreateIntakeRequest,
  buildIntakePayloadLines,
  buildPreviewRequestLines,
  canConfirmIntake,
  clearIntakeDraft,
  computeBarCounts,
  computeMarginPercent,
  countMissingPriceByBranch,
  draftAgeLabel,
  enforceBranchSelectionForKind,
  firstErrorProductId,
  loadIntakeDraft,
  priceForMarginPercent,
  quantityForIntakeBranch,
  rowStateLabel,
  salePriceForIntakeBranch,
  saveIntakeDraft,
  shortTextForErrorCode,
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
    quantity: null, overrides: {}, unitCost: null, salePrice: null, salePriceOverrides: {},
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
  assert.deepEqual(counts, { ok: 1, review: 1, error: 1, pending: 0 });
  assert.equal(canConfirmIntake(counts, rows.length), false, "con 1 error, no se puede confirmar");
  assert.equal(canConfirmIntake({ ok: 2, review: 1, error: 0, pending: 0 }, 3), true, "sin errores, sí se puede");
  assert.equal(canConfirmIntake({ ok: 0, review: 0, error: 0, pending: 0 }, 0), false, "sin ninguna fila, tampoco");
});

test("LA QUE IMPORTA — una fila con alguna celda todavía calculando no cuenta como error, pero tampoco deja confirmar", () => {
  const counts = computeBarCounts([{ productId: "p1", status: "OK" }, { productId: "p2", status: "PENDING" }]);
  assert.deepEqual(counts, { ok: 1, review: 0, error: 0, pending: 1 });
  assert.equal(canConfirmIntake(counts, 2), false, "con una fila pendiente, no se puede confirmar todavía");
});

test("LA QUE IMPORTA — vista previa que falló del todo deshabilita confirmar aunque no haya errores", () => {
  const counts = computeBarCounts([{ productId: "p1", status: "OK" }]);
  assert.equal(canConfirmIntake(counts, 1, true), false);
  assert.equal(canConfirmIntake(counts, 1, false), true);
});

test("una fila sin vista previa todavía (ninguna celda resuelta) nunca aparece lista — PENDING, no ERROR", () => {
  assert.equal(worstRowStatus([]), "PENDING");
  assert.equal(worstRowStatus(["OK", "OK"]), "OK");
  assert.equal(worstRowStatus(["OK", "REVIEW"]), "REVIEW");
  assert.equal(worstRowStatus(["OK", "REVIEW", "ERROR"]), "ERROR");
});

test("LA QUE IMPORTA — SKIPPED (0 = no lleva) nunca empeora el estado de la fila: OK+SKIPPED sigue OK", () => {
  assert.equal(worstRowStatus(["OK", "SKIPPED"]), "OK");
  assert.equal(worstRowStatus(["REVIEW", "SKIPPED"]), "REVIEW");
  assert.equal(worstRowStatus(["ERROR", "SKIPPED"]), "ERROR");
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

// ── prompt-entrada-multisucursal-fix.md Commit 2 ───────────────────────────

test("LA QUE IMPORTA — applyBranchCellInput: vacío QUITA el override (vuelve a 'para todas'), nunca lo deja en null", () => {
  const withOverride = line({ quantity: 10, overrides: { "branch-1": 5 } });
  const result = applyBranchCellInput(withOverride, "branch-1", "");
  assert.ok(!("branch-1" in result.overrides), "la clave desaparece del todo, no queda en null");
  assert.equal(quantityForIntakeBranch(result, "branch-1"), 10, "sin override, cae a 'para todas'");
});

test("applyBranchCellInput: 0 fija la celda en 0 ('no lleva'), no la quita", () => {
  const result = applyBranchCellInput(line({ quantity: 10 }), "branch-1", "0");
  assert.equal(result.overrides["branch-1"], 0);
});

test("applyBranchCellInput: un número normal fija el override de esa sucursal", () => {
  const result = applyBranchCellInput(line({ quantity: 10 }), "branch-2", "25");
  assert.equal(result.overrides["branch-2"], 25);
});

test("applyBranchCellInput: un valor no numérico no rompe nada — devuelve la línea sin tocar", () => {
  const original = line({ quantity: 10 });
  const result = applyBranchCellInput(original, "branch-1", "abc");
  assert.deepEqual(result, original);
});

test("LA QUE IMPORTA — shortTextForErrorCode: cada código cae en su texto corto correcto, nunca todo 'Falta dato'", () => {
  assert.equal(shortTextForErrorCode("MISSING_QUANTITY"), "Falta dato");
  assert.equal(shortTextForErrorCode("NO_COST_NO_AVERAGE"), "Falta dato");
  assert.equal(shortTextForErrorCode("OPENING_BALANCE_NO_COST"), "Falta costo");
  assert.equal(shortTextForErrorCode("PRODUCT_BLOCKED"), "Bloqueado");
  assert.equal(shortTextForErrorCode("OPENING_BALANCE_HAS_STOCK"), "No se puede");
  assert.equal(shortTextForErrorCode("PRICE_BELOW_COST"), "No se puede");
});

test("firstErrorProductId: el primero en el orden de las filas, no el primero alfabético", () => {
  const rows = [
    { productId: "p1", status: "OK" as const },
    { productId: "p2", status: "ERROR" as const },
    { productId: "p3", status: "ERROR" as const },
  ];
  assert.equal(firstErrorProductId(rows), "p2");
});

test("firstErrorProductId: sin ningún error, null", () => {
  assert.equal(firstErrorProductId([{ productId: "p1", status: "OK" as const }]), null);
});

// ── prompt-entrada-reintento-precio.md Commit 3 — precio de venta y margen ─

test("LA QUE IMPORTA — salePriceForIntakeBranch: el override de esa sucursal gana sobre 'para todas'", () => {
  const l = line({ salePrice: 100, salePriceOverrides: { "branch-1": 150 } });
  assert.equal(salePriceForIntakeBranch(l, "branch-1"), 150);
  assert.equal(salePriceForIntakeBranch(l, "branch-2"), 100, "sin override, usa el general");
});

test("applySalePriceCellInput: vacío quita el override (vuelve a 'para todas'), un número lo fija", () => {
  let l = line({ salePrice: 100 });
  l = applySalePriceCellInput(l, "branch-1", "180");
  assert.equal(l.salePriceOverrides["branch-1"], 180);
  l = applySalePriceCellInput(l, "branch-1", "");
  assert.ok(!("branch-1" in l.salePriceOverrides), "vacío QUITA el override, no lo deja en null");
});

test("applySalePriceCellInput: un precio <= 0 no tiene sentido, se ignora (no se guarda como override)", () => {
  const l = line({ salePrice: 100 });
  const result = applySalePriceCellInput(l, "branch-1", "0");
  assert.deepEqual(result, l, "sin cambios");
});

test("LA QUE IMPORTA — buildIntakePayloadLines manda salePriceOverrides igual que overrides de cantidad (solo donde difiere del general)", () => {
  const l = line({ quantity: 10, salePrice: 100, salePriceOverrides: { "b1": 150, "b2": 100 } });
  const [payload] = buildIntakePayloadLines([l], ["b1", "b2"]);
  assert.equal(payload.salePrice, 100);
  assert.deepEqual(payload.salePriceOverrides, { b1: 150 }, "b2 coincide con el general -- no viaja como override");
});

test("buildPreviewRequestLines incluye salePriceOverrides (o undefined si no hay ninguno)", () => {
  const withOverride = buildPreviewRequestLines([line({ salePriceOverrides: { b1: 200 } })]);
  assert.deepEqual(withOverride[0].salePriceOverrides, { b1: 200 });
  const without = buildPreviewRequestLines([line()]);
  assert.equal(without[0].salePriceOverrides, undefined);
});

test("LA QUE IMPORTA — computeMarginPercent: margen como % del precio (branch-band-service.ts), no del costo", () => {
  assert.equal(computeMarginPercent(100, 80), 20);
  assert.equal(computeMarginPercent(200, 150), 25);
  assert.equal(computeMarginPercent(0, 80), null, "sin precio positivo, no hay margen que calcular");
});

test("LA QUE IMPORTA — priceForMarginPercent (atajo +N%): calcula sobre el costo RESULTANTE recibido, es responsabilidad de quien llama pasar el costo nuevo", () => {
  // margen 20% sobre costo 80 -> precio 100 (verificación cruzada con computeMarginPercent).
  const price = priceForMarginPercent(80, 20)!;
  assert.equal(Math.round(price), 100);
  assert.equal(Math.round(computeMarginPercent(price, 80)!), 20);
});

test("rowStateLabel: ERROR por cantidad -> 'Falta cantidad'; por costo -> 'Falta costo'; nunca 'Falta dato' genérico", () => {
  assert.equal(rowStateLabel("ERROR", ["MISSING_QUANTITY"]), "Falta cantidad");
  assert.equal(rowStateLabel("ERROR", ["NO_COST_NO_AVERAGE"]), "Falta costo");
  assert.equal(rowStateLabel("ERROR", ["OPENING_BALANCE_NO_COST"]), "Falta costo");
});

test("rowStateLabel: REVIEW por margen o sin precio -> 'Revisar margen'", () => {
  assert.equal(rowStateLabel("REVIEW", ["MARGIN_BELOW_POLICY"]), "Revisar margen");
  assert.equal(rowStateLabel("REVIEW", ["NO_SALE_PRICE"]), "Revisar margen");
});

test("rowStateLabel: OK sin mensajes -> 'Listo'", () => {
  assert.equal(rowStateLabel("OK", []), "Listo");
});

test("LA QUE IMPORTA — countMissingPriceByBranch: cuenta por sucursal, no mezcla las demás", () => {
  const cells = [
    { branchId: "b1", messages: [{ code: "NO_SALE_PRICE" }] },
    { branchId: "b1", messages: [{ code: "NO_SALE_PRICE" }] },
    { branchId: "b2", messages: [{ code: "NO_SALE_PRICE" }] },
    { branchId: "b2", messages: [{ code: "MARGIN_BELOW_POLICY" }] }, // no cuenta -- no es NO_SALE_PRICE
  ];
  assert.deepEqual(countMissingPriceByBranch(cells), { b1: 2, b2: 1 });
});
