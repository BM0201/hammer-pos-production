import assert from "node:assert/strict";
import test from "node:test";
import { PaymentMethod } from "@prisma/client";
import { resolveUsdTenders } from "@/modules/payments/usd-tender";

const RATE = 36.6243;

test("US$40 a 36.6243 por C$1335: recibido C$1464.97, vuelto C$129.97 en córdobas", () => {
  const [t] = resolveUsdTenders([{ method: PaymentMethod.CASH, amount: 1335, receivedAmount: 1464.97, receivedUsdAmount: 40 }], RATE);
  assert.equal(t.receivedAmount, 1464.97);
  assert.equal(t.changeAmount, 129.97);
  assert.equal(t.usdRate, RATE);
});

test("el servidor recalcula lo recibido aunque el cliente no lo mande", () => {
  const [t] = resolveUsdTenders([{ method: PaymentMethod.CASH, amount: 1335, receivedUsdAmount: 40, changeAmount: 999 }], RATE);
  assert.equal(t.changeAmount, 129.97);
});

test("tender en córdobas no cambia", () => {
  const [t] = resolveUsdTenders([{ method: PaymentMethod.CASH, amount: 100, receivedAmount: 200, changeAmount: 100 }], null);
  assert.equal(t.receivedAmount, 200);
  assert.equal(t.usdRate, undefined);
});

test("sin tipo de cambio no se cobra en dólares", () => {
  assert.throws(() => resolveUsdTenders([{ method: PaymentMethod.CASH, amount: 100, receivedUsdAmount: 5 }], null), /USD_RATE_MISSING/);
});

test("si la pantalla usó otra tasa se rechaza (el vuelto visto sería otro)", () => {
  assert.throws(() => resolveUsdTenders([{ method: PaymentMethod.CASH, amount: 1335, receivedAmount: 1440, receivedUsdAmount: 40 }], RATE), /USD_RATE_CHANGED/);
});

test("dólares que no cubren lo aplicado se rechazan", () => {
  assert.throws(() => resolveUsdTenders([{ method: PaymentMethod.CASH, amount: 1500, receivedUsdAmount: 40 }], RATE), /INVALID_CASH_RECEIVED_AMOUNT/);
});

test("dólares solo en efectivo", () => {
  assert.throws(() => resolveUsdTenders([{ method: PaymentMethod.CARD, amount: 100, receivedUsdAmount: 5 }], RATE), /USD_TENDER_MUST_BE_CASH/);
});
