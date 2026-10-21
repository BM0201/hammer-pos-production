import assert from "node:assert/strict";
import test from "node:test";
import { validateIntakeLine, type ValidateIntakeLineInput } from "@/modules/inventory/intake-validation";

/**
 * Fase 1 (prompt-entrada-inventario.md) — "qué está bien, qué hay que
 * revisar y qué impide guardar", por línea. Pura, sin DB.
 */

function base(overrides: Partial<ValidateIntakeLineInput> = {}): ValidateIntakeLineInput {
  return {
    kind: "ADD_STOCK",
    quantity: 10,
    currentQty: 40,
    enteredCost: 100,
    currentEffectiveCost: 95,
    lastPurchaseCost: 98,
    newPrice: null,
    currentSalePrice: null,
    minMarginPercent: null,
    productBlocked: null,
    pendingPurchaseOrder: null,
    typicalPurchaseQuantity: null,
    ...overrides,
  };
}

// ── Caso feliz por kind ───────────────────────────────────────────────────

test("LA QUE IMPORTA — ADD_STOCK con todo en orden: OK", () => {
  const result = validateIntakeLine(base());
  assert.equal(result.status, "OK");
  assert.deepEqual(result.messages, []);
});

test("PHYSICAL_COUNT con todo en orden: OK", () => {
  const result = validateIntakeLine(base({ kind: "PHYSICAL_COUNT", quantity: 38, enteredCost: null }));
  assert.equal(result.status, "OK");
});

test("OPENING_BALANCE con costo y sin stock existente: OK", () => {
  const result = validateIntakeLine(base({ kind: "OPENING_BALANCE", currentQty: 0, enteredCost: 100, currentEffectiveCost: null, lastPurchaseCost: null }));
  assert.equal(result.status, "OK");
});

// ── Errores ────────────────────────────────────────────────────────────────

test("LA QUE IMPORTA — cantidad vacía (nunca escrita): ERROR, nunca se manda como 0", () => {
  const result = validateIntakeLine(base({ quantity: null }));
  assert.equal(result.status, "ERROR");
  assert.ok(result.messages.some((m) => m.code === "MISSING_QUANTITY"));
});

// prompt-entrada-multisucursal-fix.md — causa 3: antes esto daba ERROR
// "La cantidad debe ser mayor a 0", que es exactamente el bug que reportó
// el dueño (una sucursal que no lleva ese producto quedaba marcada como
// si le faltara un dato). 0 escrito a propósito en ADD_STOCK/OPENING_BALANCE
// es "esta sucursal no lleva" — SKIPPED, sin mensajes, nunca un error.
test("ADD_STOCK con cantidad 0: SKIPPED (0 = esta sucursal no lleva, no un error)", () => {
  const result = validateIntakeLine(base({ quantity: 0 }));
  assert.equal(result.status, "SKIPPED");
  assert.deepEqual(result.messages, []);
});

test("OPENING_BALANCE con cantidad 0: SKIPPED, ni siquiera exige costo (una sucursal que no lleva no necesita costo)", () => {
  const result = validateIntakeLine(base({ kind: "OPENING_BALANCE", quantity: 0, enteredCost: null, currentQty: 0 }));
  assert.equal(result.status, "SKIPPED");
});

test("PHYSICAL_COUNT con cantidad 0, pero ESCRITA explícitamente: no es error de cantidad (se permite 0 en conteo)", () => {
  const result = validateIntakeLine(base({ kind: "PHYSICAL_COUNT", quantity: 0, enteredCost: null, currentQty: 5 }));
  assert.ok(!result.messages.some((m) => m.code === "MISSING_QUANTITY"));
});

test("PHYSICAL_COUNT con cantidad negativa: ERROR", () => {
  const result = validateIntakeLine(base({ kind: "PHYSICAL_COUNT", quantity: -1, enteredCost: null }));
  assert.equal(result.status, "ERROR");
});

test("LA QUE IMPORTA — OPENING_BALANCE sin costo: ERROR", () => {
  const result = validateIntakeLine(base({ kind: "OPENING_BALANCE", currentQty: 0, enteredCost: null, currentEffectiveCost: null, lastPurchaseCost: null }));
  assert.equal(result.status, "ERROR");
  assert.ok(result.messages.some((m) => m.code === "OPENING_BALANCE_NO_COST"));
});

test("LA QUE IMPORTA — OPENING_BALANCE con stock existente: ERROR (usá Sumar o Conteo)", () => {
  const result = validateIntakeLine(base({ kind: "OPENING_BALANCE", currentQty: 15, enteredCost: 100 }));
  assert.equal(result.status, "ERROR");
  assert.ok(result.messages.some((m) => m.code === "OPENING_BALANCE_HAS_STOCK"));
});

test("ADD_STOCK sin costo y sin promedio vigente: ERROR", () => {
  const result = validateIntakeLine(base({ enteredCost: null, currentEffectiveCost: null, lastPurchaseCost: null }));
  assert.equal(result.status, "ERROR");
  assert.ok(result.messages.some((m) => m.code === "NO_COST_NO_AVERAGE"));
});

test("ADD_STOCK sin costo PERO con promedio vigente: no es error (usa el promedio actual)", () => {
  const result = validateIntakeLine(base({ enteredCost: null, currentEffectiveCost: 95 }));
  assert.ok(!result.messages.some((m) => m.code === "NO_COST_NO_AVERAGE"));
});

test("precio nuevo bajo el costo resultante: ERROR", () => {
  const result = validateIntakeLine(base({ enteredCost: 100, newPrice: 90 }));
  assert.equal(result.status, "ERROR");
  assert.ok(result.messages.some((m) => m.code === "PRICE_BELOW_COST"));
});

test("precio nuevo sobre el costo resultante: no es error", () => {
  const result = validateIntakeLine(base({ enteredCost: 100, newPrice: 150 }));
  assert.ok(!result.messages.some((m) => m.code === "PRICE_BELOW_COST"));
});

test("producto inactivo o unificado: ERROR con el motivo que da el caller", () => {
  const result = validateIntakeLine(base({ productBlocked: { reason: "Producto inactivo." } }));
  assert.equal(result.status, "ERROR");
  assert.ok(result.messages.some((m) => m.code === "PRODUCT_BLOCKED" && m.text === "Producto inactivo."));
});

// ── Para revisar ───────────────────────────────────────────────────────────

test("LA QUE IMPORTA — costo que difiere más de 40% del promedio actual: REVIEW, con el texto de paquete", () => {
  const result = validateIntakeLine(base({ enteredCost: 200, currentEffectiveCost: 100, lastPurchaseCost: 100 }));
  assert.equal(result.status, "REVIEW");
  assert.ok(result.messages.some((m) => m.code === "COST_DEVIATION" && /paquete/i.test(m.text)));
});

test("costo que difiere menos de 40%: no dispara la revisión", () => {
  const result = validateIntakeLine(base({ enteredCost: 120, currentEffectiveCost: 100, lastPurchaseCost: 100 }));
  assert.ok(!result.messages.some((m) => m.code === "COST_DEVIATION"));
});

test("costo que difiere >40% de la ÚLTIMA COMPRA aunque esté cerca del promedio: igual dispara (es 'o', no 'y')", () => {
  const result = validateIntakeLine(base({ enteredCost: 100, currentEffectiveCost: 98, lastPurchaseCost: 50 }));
  assert.ok(result.messages.some((m) => m.code === "COST_DEVIATION"));
});

test("LA QUE IMPORTA — conteo que deja el producto en 0: REVIEW", () => {
  const result = validateIntakeLine(base({ kind: "PHYSICAL_COUNT", quantity: 0, enteredCost: null, currentQty: 40 }));
  assert.equal(result.status, "REVIEW");
  assert.ok(result.messages.some((m) => m.code === "COUNT_DROPS_SHARPLY"));
});

test("conteo que baja más del 50%: REVIEW", () => {
  const result = validateIntakeLine(base({ kind: "PHYSICAL_COUNT", quantity: 15, enteredCost: null, currentQty: 40 }));
  assert.equal(result.status, "REVIEW");
  assert.ok(result.messages.some((m) => m.code === "COUNT_DROPS_SHARPLY"));
});

test("conteo que baja menos del 50%: no dispara la revisión", () => {
  const result = validateIntakeLine(base({ kind: "PHYSICAL_COUNT", quantity: 25, enteredCost: null, currentQty: 40 }));
  assert.ok(!result.messages.some((m) => m.code === "COUNT_DROPS_SHARPLY"));
});

test("conteo que SUBE no dispara la revisión de baja", () => {
  const result = validateIntakeLine(base({ kind: "PHYSICAL_COUNT", quantity: 60, enteredCost: null, currentQty: 40 }));
  assert.ok(!result.messages.some((m) => m.code === "COUNT_DROPS_SHARPLY"));
});

test("LA QUE IMPORTA — ADD_STOCK con OC pendiente: REVIEW con poId para el botón", () => {
  const result = validateIntakeLine(base({ pendingPurchaseOrder: { poId: "po-1", orderNumber: "OC-000042" } }));
  assert.equal(result.status, "REVIEW");
  const msg = result.messages.find((m) => m.code === "PENDING_PURCHASE_ORDER");
  assert.ok(msg);
  assert.equal(msg!.poId, "po-1");
  assert.match(msg!.text, /OC-000042/);
});

test("PHYSICAL_COUNT con OC pendiente no dispara el aviso (el aviso es solo para sumar)", () => {
  const result = validateIntakeLine(base({ kind: "PHYSICAL_COUNT", quantity: 38, enteredCost: null, pendingPurchaseOrder: { poId: "po-1", orderNumber: "OC-000042" } }));
  assert.ok(!result.messages.some((m) => m.code === "PENDING_PURCHASE_ORDER"));
});

test("cantidad más de 10x la compra típica: REVIEW", () => {
  const result = validateIntakeLine(base({ quantity: 300, typicalPurchaseQuantity: 20 }));
  assert.ok(result.messages.some((m) => m.code === "QUANTITY_FAR_ABOVE_TYPICAL"));
});

test("cantidad dentro de 10x la compra típica: no dispara", () => {
  const result = validateIntakeLine(base({ quantity: 150, typicalPurchaseQuantity: 20 }));
  assert.ok(!result.messages.some((m) => m.code === "QUANTITY_FAR_ABOVE_TYPICAL"));
});

test("sin historial de compra típica: nunca dispara ese aviso", () => {
  const result = validateIntakeLine(base({ quantity: 10000, typicalPurchaseQuantity: null }));
  assert.ok(!result.messages.some((m) => m.code === "QUANTITY_FAR_ABOVE_TYPICAL"));
});

// ── Prioridad: un ERROR hace status ERROR aunque también haya REVIEW ──────

test("con un error Y un aviso de revisión a la vez, el estado es ERROR (no REVIEW)", () => {
  const result = validateIntakeLine(base({ quantity: null, pendingPurchaseOrder: { poId: "po-1", orderNumber: "OC-1" } }));
  assert.equal(result.status, "ERROR");
  assert.ok(result.messages.some((m) => m.code === "MISSING_QUANTITY"));
  assert.ok(result.messages.some((m) => m.code === "PENDING_PURCHASE_ORDER"));
});

// ── prompt-entrada-reintento-precio.md Commit 3 — precio de venta y margen ─

test("LA QUE IMPORTA — sin precio de venta en la sucursal (ni nuevo ni vigente): REVIEW, nunca bloquea", () => {
  const result = validateIntakeLine(base({ currentSalePrice: 0, newPrice: null }));
  assert.equal(result.status, "REVIEW");
  assert.ok(result.messages.some((m) => m.code === "NO_SALE_PRICE"));
});

test("sin precio: PHYSICAL_COUNT nunca dispara el aviso (no cambia precios)", () => {
  const result = validateIntakeLine(base({ kind: "PHYSICAL_COUNT", quantity: 38, enteredCost: null, currentSalePrice: 0, newPrice: null }));
  assert.ok(!result.messages.some((m) => m.code === "NO_SALE_PRICE"));
});

test("currentSalePrice null (el llamador no mandó el dato — tests/llamadores viejos) nunca dispara nada nuevo", () => {
  const result = validateIntakeLine(base({ currentSalePrice: null, newPrice: null }));
  assert.equal(result.status, "OK");
});

test("hay precio vigente (currentSalePrice > 0) y no se cambia: no avisa 'sin precio'", () => {
  const result = validateIntakeLine(base({ currentSalePrice: 200, newPrice: null, minMarginPercent: null }));
  assert.ok(!result.messages.some((m) => m.code === "NO_SALE_PRICE"));
});

test("LA QUE IMPORTA — margen bajo la política de la categoría: REVIEW con el % calculado sobre el costo RESULTANTE (entrado), no el viejo", () => {
  // precio 130, costo entrado 120 (el costo viejo era 95, irrelevante acá) -> margen (130-120)/130 = 7.7%, bajo el mínimo de 20%.
  const result = validateIntakeLine(base({ currentSalePrice: 130, newPrice: null, enteredCost: 120, currentEffectiveCost: 95, minMarginPercent: 20 }));
  assert.equal(result.status, "REVIEW");
  const msg = result.messages.find((m) => m.code === "MARGIN_BELOW_POLICY");
  assert.ok(msg, "debe avisar margen bajo política");
  assert.match(msg!.text, /7\.7%/);
});

test("margen por encima de la política: no avisa", () => {
  const result = validateIntakeLine(base({ currentSalePrice: 200, newPrice: null, enteredCost: 100, minMarginPercent: 20 }));
  assert.ok(!result.messages.some((m) => m.code === "MARGIN_BELOW_POLICY"));
});

test("sin minMarginPercent (sin política configurada): nunca avisa margen, aunque el margen sea bajo", () => {
  const result = validateIntakeLine(base({ currentSalePrice: 101, newPrice: null, enteredCost: 100, minMarginPercent: null }));
  assert.ok(!result.messages.some((m) => m.code === "MARGIN_BELOW_POLICY"));
});

test("un precio nuevo (newPrice) gana sobre el vigente para calcular el margen", () => {
  // vigente 500 (margen alto), nuevo 110 contra costo 100 -> margen (110-100)/110 = 9.1%, bajo 20%.
  const result = validateIntakeLine(base({ currentSalePrice: 500, newPrice: 110, enteredCost: 100, minMarginPercent: 20 }));
  const msg = result.messages.find((m) => m.code === "MARGIN_BELOW_POLICY");
  assert.ok(msg, "debe usar el precio NUEVO, no el vigente, para el cálculo");
});

test("precio bajo costo sigue bloqueando (PRICE_BELOW_COST, sin cambios de Commit 3)", () => {
  const result = validateIntakeLine(base({ currentSalePrice: 150, newPrice: 90, enteredCost: 100, minMarginPercent: 20 }));
  assert.equal(result.status, "ERROR");
  assert.ok(result.messages.some((m) => m.code === "PRICE_BELOW_COST"));
});
