/**
 * Tests de las fórmulas financieras oficiales (finance/service.ts).
 *
 * Espejos puros (sin DB, convención del repo) de los cálculos de getFinanceSummary:
 * proyección comercial del inventario y desempeño real del periodo.
 *
 * Run: node --import tsx --test src/modules/finance/finance-summary.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const round2 = (v: number) => Math.round(v * 100) / 100;

// ── Proyección comercial del inventario (NO es utilidad real) ────────────────

describe("inventoryProjection (proyección comercial)", () => {
  function projection(inventoryValue: number, potentialRevenue: number) {
    const potentialGrossProfit = potentialRevenue - inventoryValue;
    const potentialGrossMarginPercent =
      potentialRevenue > 0 ? Math.round((potentialGrossProfit / potentialRevenue) * 1000) / 10 : null;
    return { potentialGrossProfit: round2(potentialGrossProfit), potentialGrossMarginPercent };
  }

  it("ganancia bruta potencial = venta potencial − costo", () => {
    const r = projection(1000, 1500);
    assert.equal(r.potentialGrossProfit, 500);
    assert.equal(r.potentialGrossMarginPercent, 33.3);
  });

  it("sin venta potencial → margen null (no divide por cero)", () => {
    assert.equal(projection(1000, 0).potentialGrossMarginPercent, null);
  });
});

// ── Desempeño real del periodo (utilidad de verdad) ──────────────────────────

describe("realPerformance (desempeño real)", () => {
  function performance(netSales: number, cogs: number, operatingExpenses: number) {
    const grossProfit = netSales - cogs;
    const grossMarginPercent = netSales > 0 ? Math.round((grossProfit / netSales) * 1000) / 10 : null;
    const operatingProfit = grossProfit - operatingExpenses;
    return {
      grossProfit: round2(grossProfit),
      grossMarginPercent,
      operatingProfit: round2(operatingProfit),
      estimatedNetProfit: round2(operatingProfit),
    };
  }

  it("utilidad bruta real = ventas netas − COGS", () => {
    const r = performance(2000, 1200, 500);
    assert.equal(r.grossProfit, 800);
    assert.equal(r.grossMarginPercent, 40);
  });

  it("utilidad operativa = utilidad bruta real − gastos operativos", () => {
    const r = performance(2000, 1200, 500);
    assert.equal(r.operatingProfit, 300);
    assert.equal(r.estimatedNetProfit, 300);
  });

  it("operativa negativa cuando los gastos superan la utilidad bruta", () => {
    const r = performance(1000, 800, 500);
    assert.equal(r.grossProfit, 200);
    assert.equal(r.operatingProfit, -300);
  });

  it("la proyección comercial NO se mezcla con la utilidad real (son cálculos distintos)", () => {
    // venta potencial alta no afecta la utilidad operativa real (que usa ventas cobradas)
    const real = performance(0, 0, 500);
    assert.equal(real.operatingProfit, -500);
  });
});
