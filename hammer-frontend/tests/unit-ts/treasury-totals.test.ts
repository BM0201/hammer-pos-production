import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTreasuryTotals } from "@/lib/treasury-totals";

describe("computeTreasuryTotals", () => {
  it("suma accumulatedAmount para el total acumulado", () => {
    const totals = computeTreasuryTotals([
      { accumulatedAmount: 1000, directDepositAvailable: 1000 },
      { accumulatedAmount: 500, directDepositAvailable: 500 },
    ]);
    assert.equal(totals.accumulated, 1500);
  });

  it("suma directDepositAvailable para el total a depositar, no pendingDeposit", () => {
    // Si una sucursal tuviera pendingDeposit distinto de directDepositAvailable
    // (gaveta abierta con plata), el total NUNCA debe reflejarlo — Tesorería
    // es el punto final, la caja no entra acá.
    const totals = computeTreasuryTotals([
      { accumulatedAmount: 1000, directDepositAvailable: 800 },
      { accumulatedAmount: 500, directDepositAvailable: 500 },
    ]);
    assert.equal(totals.pendingDeposit, 1300);
  });

  it("sin sucursales, ambos totales en 0", () => {
    const totals = computeTreasuryTotals([]);
    assert.equal(totals.accumulated, 0);
    assert.equal(totals.pendingDeposit, 0);
  });
});
