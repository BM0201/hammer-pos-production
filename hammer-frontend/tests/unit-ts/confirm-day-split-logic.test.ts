import assert from "node:assert/strict";
import test from "node:test";
import { splitCashDifference } from "@/components/operations/confirm-day-dialog";

// Masaya 2026-11-21: abrió con C$40, cobró C$19,505 en efectivo, contó C$21,710 y dejó C$10 de sencillo.
const msy = { status: "CLOSED", openingAmount: 40, expectedCashAmount: 19545, countedCashAmount: 21710, cashFundClosedAmount: 10 };

test("separa la diferencia en venta en efectivo y sencillo, y suman la diferencia total", () => {
  const split = splitCashDifference([msy]);
  assert.ok(split);
  assert.deepEqual([split.salesExpected, split.salesCounted, split.fundOpened, split.fundClosed], [19505, 21700, 40, 10]);
  assert.equal((split.salesCounted - split.salesExpected) + (split.fundClosed - split.fundOpened), 21710 - 19545);
  assert.equal(split.usd, null);
});

test("sin sencillo declarado en alguna caja cerrada no inventa el desglose; las abiertas no cuentan", () => {
  assert.equal(splitCashDifference([{ ...msy, cashFundClosedAmount: null }]), null);
  assert.ok(splitCashDifference([msy, { ...msy, status: "OPEN", cashFundClosedAmount: null }]));
  assert.equal(splitCashDifference([]), null);
});

test("dólares aparte cuando hubo", () => {
  assert.deepEqual(splitCashDifference([{ ...msy, expectedUsdAmount: 40, countedUsdAmount: 40 }])?.usd, { expected: 40, counted: 40, nio: 0 });
  // Rivas 21-nov: US$40 contados sin cobros en dólares. Sin tasa no se pueden sumar; con tasa, sí.
  assert.equal(splitCashDifference([{ ...msy, countedUsdAmount: 40 }])?.usd?.nio, null);
  assert.equal(splitCashDifference([{ ...msy, countedUsdAmount: 40, countedUsdRate: 36.6 }])?.usd?.nio, 1464);
});
