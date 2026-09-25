/**
 * prompt-pendientes-2026-09.md Fase 3 (PENDIENTES #8) — lógica pura del
 * formulario de solicitud de devolución: destino derivado de la condición,
 * estimado de reembolso en vivo (espejo de calculateRefundableAmount) y el
 * tipo PARTIAL/TOTAL calculado, no preguntado. Importa directo del
 * componente (mismo patrón que quickCashAmounts en payment-composer.tsx).
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  destinationForCondition,
  estimateRefundableAmount,
  deriveReturnType,
} from "@/components/sales/sale-return-request-sheet";

describe("destinationForCondition", () => {
  it("GOOD siempre va a SELLABLE", () => {
    assert.equal(destinationForCondition("GOOD"), "SELLABLE");
  });
  it("DAMAGED siempre va a DAMAGED", () => {
    assert.equal(destinationForCondition("DAMAGED"), "DAMAGED");
  });
  it("NOT_RETURNED siempre va a NONE", () => {
    assert.equal(destinationForCondition("NOT_RETURNED"), "NONE");
  });
});

describe("estimateRefundableAmount", () => {
  it("es proporcional a la cantidad solicitada sobre la original", () => {
    const amount = estimateRefundableAmount({ lineSubtotal: 500, quantity: 5, requestedQty: 2 });
    assert.equal(amount, 200);
  });
  it("devuelve 0 si la cantidad original es 0 (evita dividir por cero)", () => {
    const amount = estimateRefundableAmount({ lineSubtotal: 100, quantity: 0, requestedQty: 0 });
    assert.equal(amount, 0);
  });
  it("redondea a 2 decimales", () => {
    const amount = estimateRefundableAmount({ lineSubtotal: 100, quantity: 3, requestedQty: 1 });
    assert.equal(amount, 33.33);
  });
});

describe("deriveReturnType", () => {
  it("TOTAL cuando se devuelve todo lo disponible de la única línea con stock", () => {
    const type = deriveReturnType([{ available: 5, requestedQty: 5 }]);
    assert.equal(type, "TOTAL");
  });
  it("PARTIAL cuando queda algo sin devolver en una línea", () => {
    const type = deriveReturnType([{ available: 5, requestedQty: 3 }]);
    assert.equal(type, "PARTIAL");
  });
  it("TOTAL exige que TODAS las líneas con stock disponible se agoten, no solo una", () => {
    const type = deriveReturnType([{ available: 5, requestedQty: 5 }, { available: 2, requestedQty: 1 }]);
    assert.equal(type, "PARTIAL");
  });
  it("una línea sin nada disponible (available=0) no bloquea TOTAL", () => {
    const type = deriveReturnType([{ available: 5, requestedQty: 5 }, { available: 0, requestedQty: 0 }]);
    assert.equal(type, "TOTAL");
  });
  it("sin líneas con stock disponible, por defecto PARTIAL", () => {
    const type = deriveReturnType([{ available: 0, requestedQty: 0 }]);
    assert.equal(type, "PARTIAL");
  });
});
