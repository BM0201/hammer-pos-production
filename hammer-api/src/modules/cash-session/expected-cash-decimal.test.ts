import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, CashMovementType, PaymentMethod } from "@prisma/client";
import {
  cashMovementsNetTotalDecimal,
  cashTenderTotalDecimal,
  computeExpectedCashDecimal,
  tenderTotalsByMethodDecimal,
} from "@/modules/cash-session/expected-cash";

/**
 * Día Operativo v2 Fase 1 — el bug a matar: `calculateOperationalSummaryTx`
 * sumaba con `n() = Number(value)` sobre `number`, arrastrando drift de punto
 * flotante (0.1 + 0.2 = 0.30000000000000004) que se congelaba en el snapshot
 * del cierre. Las variantes Decimal-nativas de expected-cash.ts (usadas ahora
 * por operations/service.ts) deben sumar exacto.
 */

test("Test decimal: 0.10 + 0.20 + 0.30 suma exacto (0.60), no 0.6000000000000001", () => {
  // En number puro: 0.1 + 0.2 + 0.3 === 0.6000000000000001 (drift real de JS).
  const floatDrift = 0.1 + 0.2 + 0.3;
  assert.notEqual(floatDrift, 0.6, "demuestra que el drift de float es real en JS");

  const tenders = [
    { method: PaymentMethod.CASH, amount: new Prisma.Decimal("0.10") },
    { method: PaymentMethod.CASH, amount: new Prisma.Decimal("0.20") },
    { method: PaymentMethod.CASH, amount: new Prisma.Decimal("0.30") },
  ];
  const total = cashTenderTotalDecimal(tenders);
  assert.equal(total.toNumber(), 0.6);
  assert.equal(total.toFixed(2), "0.60");
});

test("Test decimal: escenario del mockup — 62,900.00 exacto (apertura + cobrado − gasto)", () => {
  const openingAmount = new Prisma.Decimal("2000.00");
  const openingAmount2 = new Prisma.Decimal("2000.00"); // 2 cajas
  const opening = openingAmount.add(openingAmount2);

  // Muchos tenders CASH pequeños que en float arrastrarían centavos fantasma.
  const tenders = Array.from({ length: 624 }, () => ({ method: PaymentMethod.CASH, amount: new Prisma.Decimal("100.00") }));
  const postedCashPayments = cashTenderTotalDecimal(tenders); // 624 * 100.00 = 62,400.00

  const movements = [{ type: CashMovementType.EXPENSE_OUT, amount: new Prisma.Decimal("3500.00") }];
  const cashMovementsNet = cashMovementsNetTotalDecimal(movements); // -3,500.00

  const expected = computeExpectedCashDecimal({ openingAmount: opening, postedCashPayments, cashMovementsNet });

  assert.equal(expected.toNumber(), 62900);
  assert.equal(expected.toFixed(2), "62900.00", "debe ser 62,900.00 exacto, nunca 62,900.0000000113");
});

test("Test decimal: tenderTotalsByMethodDecimal agrupa exacto por método, net === amount (vuelto no se resta)", () => {
  const tenders = [
    { method: PaymentMethod.CASH, amount: new Prisma.Decimal("1000.10"), changeAmount: new Prisma.Decimal("120.00") },
    { method: PaymentMethod.CASH, amount: new Prisma.Decimal("500.20"), changeAmount: new Prisma.Decimal("0") },
    { method: PaymentMethod.CARD, amount: new Prisma.Decimal("800.30"), changeAmount: new Prisma.Decimal("0") },
  ];
  const totals = tenderTotalsByMethodDecimal(tenders);
  assert.equal(totals.CASH.amount.toNumber(), 1500.3);
  assert.equal(totals.CASH.net.toNumber(), 1500.3, "net === amount, el vuelto no se resta (ver invariante en expected-cash.ts)");
  assert.equal(totals.CASH.changeAmount.toNumber(), 120);
  assert.equal(totals.CARD.amount.toNumber(), 800.3);
});

test("Test decimal: cashMovementsNetTotalDecimal resta outflows exacto", () => {
  const movements = [
    { type: CashMovementType.CASH_IN, amount: new Prisma.Decimal("0.10") },
    { type: CashMovementType.EXPENSE_OUT, amount: new Prisma.Decimal("0.05") },
    { type: CashMovementType.CASH_OUT, amount: new Prisma.Decimal("0.02") },
  ];
  const net = cashMovementsNetTotalDecimal(movements);
  assert.equal(net.toFixed(2), "0.03");
});
