/**
 * Run: node --import tsx --test src/modules/payroll/payroll-disbursement.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function splitNetPay(netPay: number) {
  const half = Math.round((netPay / 2) * 100) / 100;
  return { firstHalf: half, secondHalf: Math.round((netPay - half) * 100) / 100 };
}

describe("splitNetPay (50/50 fijo)", () => {
  it("divide exacto cuando el neto es par en centavos", () => {
    const r = splitNetPay(1000);
    assert.equal(r.firstHalf, 500);
    assert.equal(r.secondHalf, 500);
    assert.equal(r.firstHalf + r.secondHalf, 1000);
  });

  it("ajusta el residuo de centavo en la segunda mitad, la suma siempre cuadra", () => {
    const r = splitNetPay(1000.01);
    assert.equal(r.firstHalf + r.secondHalf, 1000.01);
  });

  it("maneja neto cero (empleado con 0 días trabajados)", () => {
    const r = splitNetPay(0);
    assert.equal(r.firstHalf, 0);
    assert.equal(r.secondHalf, 0);
  });
});
