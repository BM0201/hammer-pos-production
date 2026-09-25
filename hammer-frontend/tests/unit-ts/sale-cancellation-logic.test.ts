/**
 * prompt-historial-sucursal.md Fase 3 — lógica pura de las pantallas de
 * anulación (historial de sucursal). Importa directo de los componentes
 * (mismo patrón que quickCashAmounts en payment-composer.tsx), sin montar
 * React ni JSDOM.
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canRequestCancellation } from "@/components/sales/orders-admin";
import { needsCashRefundHandling } from "@/components/sales/sale-cancellation-execute-modal";

describe("canRequestCancellation", () => {
  it("orden no cancelable: no se puede solicitar", () => {
    const result = canRequestCancellation({ cancellable: false, cancellations: [] });
    assert.equal(result, false);
  });

  it("con una anulación REQUESTED en curso: bloquea una segunda solicitud", () => {
    const result = canRequestCancellation({ cancellable: true, cancellations: [{ status: "REQUESTED" }] });
    assert.equal(result, false);
  });

  it("con una anulación APPROVED en curso: también bloquea", () => {
    const result = canRequestCancellation({ cancellable: true, cancellations: [{ status: "APPROVED" }] });
    assert.equal(result, false);
  });

  it("con una anulación REJECTED: permite solicitar de nuevo", () => {
    const result = canRequestCancellation({ cancellable: true, cancellations: [{ status: "REJECTED" }] });
    assert.equal(result, true);
  });

  it("sin anulaciones: permite solicitar", () => {
    const result = canRequestCancellation({ cancellable: true, cancellations: [] });
    assert.equal(result, true);
  });

  it("sin detalle (null): no se puede solicitar", () => {
    assert.equal(canRequestCancellation(null), false);
  });
});

describe("needsCashRefundHandling", () => {
  it("sin pagos: no hace falta el picker", () => {
    assert.equal(needsCashRefundHandling([]), false);
  });

  it("solo tarjeta: no hace falta el picker", () => {
    const result = needsCashRefundHandling([{ status: "POSTED", tenders: [{ method: "CARD", amount: 100 }] }]);
    assert.equal(result, false);
  });

  it("con efectivo: hace falta el picker", () => {
    const result = needsCashRefundHandling([{ status: "POSTED", tenders: [{ method: "CASH", amount: 100 }] }]);
    assert.equal(result, true);
  });

  it("mixto (efectivo + tarjeta): hace falta el picker", () => {
    const result = needsCashRefundHandling([
      { status: "POSTED", tenders: [{ method: "CASH", amount: 50 }, { method: "CARD", amount: 50 }] },
    ]);
    assert.equal(result, true);
  });

  it("pago con efectivo pero no POSTED: no cuenta", () => {
    const result = needsCashRefundHandling([{ status: "VOIDED", tenders: [{ method: "CASH", amount: 100 }] }]);
    assert.equal(result, false);
  });
});
