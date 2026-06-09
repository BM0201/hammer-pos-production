import { test } from "node:test";
import assert from "node:assert/strict";
import { SaleOrderStatus } from "@prisma/client";
import {
  assertDispatchableOrder,
  assertEditableOrder,
  assertOrderNotVoidedOrTest,
  assertPayableOrder,
  GuardableOrder,
  mapOrderGuardError,
  ORDER_GUARD_ERRORS,
} from "@/modules/sales/helpers/order-guards";

/**
 * Tests de regresión del bug de "orden anulada / de prueba cobrable".
 *
 * Garantizan que NUNCA se pueda editar, cobrar ni despachar una orden con
 * `voidedAt != null` o `isTest = true`, sin importar su `status`. Este es el
 * comportamiento que faltaba y que permitió cobrar la orden SO-MSY-MQ6VKAV0.
 */

function makeOrder(overrides: Partial<GuardableOrder> = {}): GuardableOrder {
  return {
    status: SaleOrderStatus.DRAFT,
    voidedAt: null,
    isTest: false,
    ...overrides,
  };
}

// ── assertOrderNotVoidedOrTest ──────────────────────────────────────────────

test("assertOrderNotVoidedOrTest pasa en orden normal", () => {
  assert.doesNotThrow(() => assertOrderNotVoidedOrTest(makeOrder()));
});

test("assertOrderNotVoidedOrTest rechaza orden anulada", () => {
  assert.throws(
    () => assertOrderNotVoidedOrTest(makeOrder({ voidedAt: new Date() })),
    /ORDER_VOIDED/,
  );
});

test("assertOrderNotVoidedOrTest rechaza orden de prueba", () => {
  assert.throws(
    () => assertOrderNotVoidedOrTest(makeOrder({ isTest: true })),
    /ORDER_IS_TEST/,
  );
});

test("voidedAt tiene prioridad sobre isTest (anulada se reporta primero)", () => {
  assert.throws(
    () => assertOrderNotVoidedOrTest(makeOrder({ voidedAt: new Date(), isTest: true })),
    /ORDER_VOIDED/,
  );
});

// ── assertEditableOrder ─────────────────────────────────────────────────────

test("assertEditableOrder pasa en DRAFT no anulada/no prueba", () => {
  assert.doesNotThrow(() => assertEditableOrder(makeOrder()));
});

test("assertEditableOrder rechaza DRAFT anulada (bug original)", () => {
  assert.throws(
    () => assertEditableOrder(makeOrder({ status: SaleOrderStatus.DRAFT, voidedAt: new Date() })),
    /ORDER_VOIDED/,
  );
});

test("assertEditableOrder rechaza DRAFT de prueba (bug original)", () => {
  assert.throws(
    () => assertEditableOrder(makeOrder({ status: SaleOrderStatus.DRAFT, isTest: true })),
    /ORDER_IS_TEST/,
  );
});

test("assertEditableOrder rechaza estado no DRAFT", () => {
  assert.throws(
    () => assertEditableOrder(makeOrder({ status: SaleOrderStatus.PENDING_PAYMENT })),
    /ORDER_NOT_DRAFT/,
  );
});

// ── assertPayableOrder ──────────────────────────────────────────────────────

test("assertPayableOrder pasa en PENDING_PAYMENT válida", () => {
  assert.doesNotThrow(() =>
    assertPayableOrder(makeOrder({ status: SaleOrderStatus.PENDING_PAYMENT })),
  );
});

test("assertPayableOrder rechaza PENDING_PAYMENT anulada", () => {
  assert.throws(
    () => assertPayableOrder(makeOrder({ status: SaleOrderStatus.PENDING_PAYMENT, voidedAt: new Date() })),
    /ORDER_VOIDED/,
  );
});

test("assertPayableOrder rechaza PENDING_PAYMENT de prueba", () => {
  assert.throws(
    () => assertPayableOrder(makeOrder({ status: SaleOrderStatus.PENDING_PAYMENT, isTest: true })),
    /ORDER_IS_TEST/,
  );
});

test("assertPayableOrder rechaza estado distinto de PENDING_PAYMENT", () => {
  assert.throws(
    () => assertPayableOrder(makeOrder({ status: SaleOrderStatus.DRAFT })),
    /PAYMENT_INVALID_STATUS/,
  );
});

// ── assertDispatchableOrder ─────────────────────────────────────────────────

test("assertDispatchableOrder pasa en DISPATCH_PENDING válida", () => {
  assert.doesNotThrow(() =>
    assertDispatchableOrder(makeOrder({ status: SaleOrderStatus.DISPATCH_PENDING })),
  );
});

test("assertDispatchableOrder rechaza DISPATCH_PENDING anulada", () => {
  assert.throws(
    () => assertDispatchableOrder(makeOrder({ status: SaleOrderStatus.DISPATCH_PENDING, voidedAt: new Date() })),
    /ORDER_VOIDED/,
  );
});

test("assertDispatchableOrder rechaza DISPATCH_PENDING de prueba", () => {
  assert.throws(
    () => assertDispatchableOrder(makeOrder({ status: SaleOrderStatus.DISPATCH_PENDING, isTest: true })),
    /ORDER_IS_TEST/,
  );
});

test("assertDispatchableOrder rechaza estado no despachable", () => {
  assert.throws(
    () => assertDispatchableOrder(makeOrder({ status: SaleOrderStatus.DRAFT })),
    /DISPATCH_INVALID_STATUS/,
  );
});

// ── mapOrderGuardError ──────────────────────────────────────────────────────

test("mapOrderGuardError mapea ORDER_VOIDED a 409", () => {
  const mapped = mapOrderGuardError(new Error(ORDER_GUARD_ERRORS.VOIDED));
  assert.equal(mapped?.code, "ORDER_VOIDED");
  assert.equal(mapped?.httpStatus, 409);
});

test("mapOrderGuardError mapea ORDER_IS_TEST a 409", () => {
  const mapped = mapOrderGuardError(new Error(ORDER_GUARD_ERRORS.IS_TEST));
  assert.equal(mapped?.code, "ORDER_IS_TEST");
  assert.equal(mapped?.httpStatus, 409);
});

test("mapOrderGuardError mapea ORDER_NOT_DRAFT a 409", () => {
  const mapped = mapOrderGuardError(new Error(ORDER_GUARD_ERRORS.NOT_DRAFT));
  assert.equal(mapped?.code, "ORDER_NOT_DRAFT");
  assert.equal(mapped?.httpStatus, 409);
});

test("mapOrderGuardError devuelve null para errores ajenos", () => {
  assert.equal(mapOrderGuardError(new Error("ALGO_RANDOM")), null);
});
