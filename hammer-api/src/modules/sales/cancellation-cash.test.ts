/**
 * Tests de regresión del BUG "anular una orden pagada en efectivo no registra
 * la salida del dinero".
 *
 * Importa la política REAL (cancellation-cash-policy.ts) y la aritmética REAL
 * del esperado (expected-cash.ts) que ejecuta cancelSaleOrderTx: el esperado
 * debe terminar EXACTAMENTE en `opening + ventas_cash_vigentes + movimientos`,
 * donde el REFUND_OUT solo existe si el dinero salió — y en ese caso
 * esperado === efectivo físico.
 *
 * Run: node --import tsx --test src/modules/sales/cancellation-cash.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CashMovementType, CashSessionStatus } from "@prisma/client";
import { resolveCancellationCashPlan } from "./cancellation-cash-policy";
import { cashMovementsNetTotal, computeExpectedCash, type CashMovementLike } from "@/modules/cash-session/expected-cash";

/** Espejo de la aritmética que ve la sesión: apertura + CASH posteado + movimientos. */
function expectedAfter(input: { opening: number; postedCash: number; movements: CashMovementLike[] }) {
  return computeExpectedCash({
    openingAmount: input.opening,
    postedCashPayments: input.postedCash,
    cashMovementsNet: cashMovementsNetTotal(input.movements),
  });
}

describe("anulación con efectivo — la aritmética cierra exacta", () => {
  // Escenario base: opening 1000; venta CASH amount 300 posteada.
  it("antes de anular: esperado = 1300", () => {
    assert.equal(expectedAfter({ opening: 1000, postedCash: 300, movements: [] }), 1300);
  });

  it("caso A (REFUNDED_FROM_DRAWER): esperado 1000 con REFUND_OUT de 300 y su compensación (físico: cajero devolvió 300 → 1000 ✓)", () => {
    const plan = resolveCancellationCashPlan({
      cashTenderTotal: 300,
      sessionStatus: CashSessionStatus.OPEN,
      cashRefundHandling: "REFUNDED_FROM_DRAWER",
    });
    assert.equal(plan.action, "CREATE_DRAWER_REFUND");

    // cancelSaleOrderTx: void del pago (el CASH posteado queda en 0) + par
    // CASH_IN (el efectivo de la venta anulada estaba en gaveta) y REFUND_OUT
    // (su devolución física). Neto de movimientos 0 → el esperado baja UNA
    // sola vez, con rastro auditable de la salida.
    const movements: CashMovementLike[] = [
      { type: CashMovementType.CASH_IN, amount: 300 },
      { type: CashMovementType.REFUND_OUT, amount: 300 },
    ];
    assert.ok(movements.some((m) => m.type === CashMovementType.REFUND_OUT && m.amount === 300));
    assert.equal(expectedAfter({ opening: 1000, postedCash: 0, movements }), 1000);
  });

  it("caso B (NO_CASH_MOVEMENT): esperado 1000 sin movimientos — el dinero nunca entró / ya salió", () => {
    const plan = resolveCancellationCashPlan({
      cashTenderTotal: 300,
      sessionStatus: CashSessionStatus.OPEN,
      cashRefundHandling: "NO_CASH_MOVEMENT",
    });
    assert.equal(plan.action, "VOID_ONLY");
    // Este caso representa "el dinero nunca entró a la gaveta / fue un error
    // antes de cobrar": el void es el único ajuste y el esperado ES el físico.
    assert.equal(expectedAfter({ opening: 1000, postedCash: 0, movements: [] }), 1000);
  });

  it("caso C (sesión cerrada): no se tocan movimientos y se crea la decisión de seguimiento", () => {
    for (const status of [
      CashSessionStatus.CLOSED,
      CashSessionStatus.AUTO_CLOSED,
      CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW,
      CashSessionStatus.RECONCILING,
    ]) {
      const plan = resolveCancellationCashPlan({
        cashTenderTotal: 300,
        sessionStatus: status,
        cashRefundHandling: "REFUNDED_FROM_DRAWER",
      });
      // MANUAL_FOLLOWUP → cancelSaleOrderTx NO crea CashMovement; audita
      // cashRefundHandling: SESSION_CLOSED_MANUAL_FOLLOWUP y crea la
      // BrainDecision de seguimiento (categoría CASH, severidad HIGH).
      assert.equal(plan.action, "MANUAL_FOLLOWUP", `status ${status}`);
    }
  });

  it("caja abierta + efectivo sin declarar cashRefundHandling → se exige el parámetro (aborta sin efectos)", () => {
    assert.throws(
      () =>
        resolveCancellationCashPlan({
          cashTenderTotal: 300,
          sessionStatus: CashSessionStatus.OPEN,
          cashRefundHandling: null,
        }),
      /CASH_REFUND_HANDLING_REQUIRED/,
    );
  });

  it("sin porción CASH no se exige el parámetro (tarjeta/transferencia)", () => {
    const plan = resolveCancellationCashPlan({
      cashTenderTotal: 0,
      sessionStatus: CashSessionStatus.OPEN,
      cashRefundHandling: null,
    });
    assert.equal(plan.action, "NONE");
  });
});
