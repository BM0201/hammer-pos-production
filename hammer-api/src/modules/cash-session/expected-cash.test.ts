/**
 * Tests de regresión del BUG "el vuelto se resta dos veces".
 *
 * `normalizeTenders` (payments/service.ts) garantiza que `tender.amount` es el
 * monto APLICADO a la orden (Σ amount === grandTotal; received − amount ===
 * change): el vuelto sale del excedente recibido y NUNCA debe restarse del
 * efectivo esperado. Antes del fix, calculateExpectedCashForSessionTx restaba
 * `cashChange` (esperado corto) y calculateOperationalSummaryTx usaba
 * `amount − change` en cashTenderNetTotal y totalsByPaymentMethod.net.
 *
 * Importa las funciones REALES (módulo puro expected-cash.ts) que ahora usan
 * ambos servicios.
 *
 * Run: node --import tsx --test src/modules/cash-session/expected-cash.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CashMovementType, PaymentMethod } from "@prisma/client";
import {
  cashMovementsNetTotal,
  cashTenderTotal,
  computeExpectedCash,
  tenderTotalsByMethod,
} from "./expected-cash";

describe("expectedCash por sesión (el vuelto NO se resta)", () => {
  it("opening 2000 + venta CASH amount 850 (received 1000, change 150) → esperado 2850, no 2700", () => {
    // El cliente entregó 1,000 y se llevó 150 de vuelto en el mismo acto:
    // a la gaveta entran netos 850 (= amount). Antes del fix el código daba
    // 2000 + 850 − 150 = 2700 y el arqueo quedaba corto por el vuelto.
    const expected = computeExpectedCash({
      openingAmount: 2000,
      postedCashPayments: 850, // Σ tender.amount CASH — el vuelto no participa
      cashMovementsNet: cashMovementsNetTotal([]),
    });
    assert.equal(expected, 2850);
  });

  it("mismo escenario + EXPENSE_OUT de 200 → esperado 2650", () => {
    const movementsNet = cashMovementsNetTotal([{ type: CashMovementType.EXPENSE_OUT, amount: 200 }]);
    assert.equal(movementsNet, -200);
    const expected = computeExpectedCash({
      openingAmount: 2000,
      postedCashPayments: 850,
      cashMovementsNet: movementsNet,
    });
    assert.equal(expected, 2650);
  });

  it("las entradas de caja suman y las salidas restan (lista compartida de outflows)", () => {
    const net = cashMovementsNetTotal([
      { type: CashMovementType.CASH_IN, amount: 100 },
      { type: CashMovementType.CHANGE_IN, amount: 50 },
      { type: CashMovementType.CASH_OUT, amount: 30 },
      { type: CashMovementType.BANK_DEPOSIT_OUT, amount: 40 },
      { type: CashMovementType.REFUND_OUT, amount: 20 },
    ]);
    assert.equal(net, 100 + 50 - 30 - 40 - 20);
  });
});

describe("resumen del día operativo (tenders CASH sin restar vuelto)", () => {
  // Dos tenders CASH del día: amount 850/change 150 y amount 500/change 0.
  const dayTenders = [
    { method: PaymentMethod.CASH, amount: 850, changeAmount: 150 },
    { method: PaymentMethod.CASH, amount: 500, changeAmount: 0 },
    { method: PaymentMethod.CARD, amount: 700, changeAmount: 0 },
  ];

  it("cashTenderNetTotal === Σ amount(CASH) = 1350 (antes daba 1200)", () => {
    assert.equal(cashTenderTotal(dayTenders), 1350);
  });

  it("totalsByPaymentMethod.CASH.net === 1350 y changeAmount queda como campo informativo (150)", () => {
    const totals = tenderTotalsByMethod(dayTenders);
    assert.equal(totals.CASH.net, 1350);
    assert.equal(totals.CASH.amount, 1350);
    assert.equal(totals.CASH.changeAmount, 150); // informativo, NO restado
    assert.equal(totals.CARD.net, 700);
  });

  it("expectedCashOnHand del día = opening + Σ amount(CASH) + movimientos", () => {
    const expected = computeExpectedCash({
      openingAmount: 2000,
      postedCashPayments: cashTenderTotal(dayTenders),
      cashMovementsNet: cashMovementsNetTotal([{ type: CashMovementType.EXPENSE_OUT, amount: 200 }]),
    });
    assert.equal(expected, 2000 + 1350 - 200);
  });
});
