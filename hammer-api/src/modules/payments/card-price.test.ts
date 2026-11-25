import assert from "node:assert/strict";
import test from "node:test";
import { PaymentMethod } from "@prisma/client";
import { applyCardPrice } from "@/modules/payments/card-price";

test("cemento C$440 con tarjeta: se cobran C$466.40 (sin el 6% de descuento de contado)", () => {
  const { tenders, extra } = applyCardPrice([{ method: PaymentMethod.CARD, amount: 440, referenceNumber: "123" }]);
  assert.equal(tenders[0].amount, 466.4);
  assert.equal(tenders[0].referenceNumber, "123");
  assert.equal(extra.toNumber(), 26.4);
});

test("pago mixto: solo la parte de tarjeta pierde el descuento", () => {
  const { tenders, extra } = applyCardPrice([
    { method: PaymentMethod.CASH, amount: 1000 },
    { method: PaymentMethod.CARD, amount: 333.33 },
    { method: PaymentMethod.TRANSFER, amount: 200 },
  ]);
  assert.deepEqual(tenders.map((t) => t.amount), [1000, 353.33, 200]); // 333.33 × 6% = 19.9998 → 20.00
  assert.equal(extra.toNumber(), 20);
});

test("sin tarjeta no cambia nada", () => {
  const input = [{ method: PaymentMethod.CASH, amount: 440 }];
  const { tenders, extra } = applyCardPrice(input);
  assert.equal(tenders[0], input[0]);
  assert.equal(extra.toNumber(), 0);
});
