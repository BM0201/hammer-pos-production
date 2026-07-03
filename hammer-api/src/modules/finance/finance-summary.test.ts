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

// ── Reglas contables de ventas netas y COGS (con devoluciones) ───────────────

describe("ventas netas y COGS con devoluciones (reglas contables)", () => {
  function netos(input: {
    grossSales: number;
    refunds: number;
    cogsOut: number;
    cogsReturnedSellable: number;
  }) {
    const netSales = input.grossSales - input.refunds;
    const cogs = input.cogsOut - input.cogsReturnedSellable;
    const grossProfit = netSales - cogs;
    return { netSales: round2(netSales), cogs: round2(cogs), grossProfit: round2(grossProfit) };
  }

  it("ventas netas = brutas − reembolsos POSTED del periodo", () => {
    const r = netos({ grossSales: 5000, refunds: 400, cogsOut: 3000, cogsReturnedSellable: 240 });
    assert.equal(r.netSales, 4600);
  });

  it("COGS neto = salidas por venta − reingresos VENDIBLES por devolución", () => {
    const r = netos({ grossSales: 5000, refunds: 400, cogsOut: 3000, cogsReturnedSellable: 240 });
    assert.equal(r.cogs, 2760);
    assert.equal(r.grossProfit, 1840);
  });

  it("una devolución dañada NO reduce el COGS (queda como merma)", () => {
    // La mercadería dañada re-entra por RETURN_IN_DAMAGED, que el servicio excluye
    // del neteo: solo se pasa cogsReturnedSellable de los tipos vendibles.
    const conDanada = netos({ grossSales: 1000, refunds: 100, cogsOut: 600, cogsReturnedSellable: 0 });
    assert.equal(conDanada.cogs, 600);
    assert.equal(conDanada.grossProfit, 300);
  });

  it("sin ventas, las devoluciones producen ventas netas negativas visibles (no se ocultan)", () => {
    const r = netos({ grossSales: 0, refunds: 250, cogsOut: 0, cogsReturnedSellable: 150 });
    assert.equal(r.netSales, -250);
    assert.equal(r.cogs, -150);
  });
});

// ── Corte de mes contable en hora Managua ─────────────────────────────────────

describe("managuaMonthRangeUtc (corte de mes en Managua, UTC-6 sin DST)", () => {
  function range(year: number, month: number) {
    return {
      start: new Date(Date.UTC(year, month - 1, 1, 6)),
      end: new Date(Date.UTC(year, month, 1, 6)),
    };
  }

  it("medianoche Managua del dia 1 = 06:00 UTC", () => {
    const { start, end } = range(2026, 7);
    assert.equal(start.toISOString(), "2026-07-01T06:00:00.000Z");
    assert.equal(end.toISOString(), "2026-08-01T06:00:00.000Z");
  });

  it("una venta a las 8pm Managua del 31 de julio pertenece a JULIO (antes caia en agosto)", () => {
    const { start, end } = range(2026, 7);
    const ventaNocturna = new Date("2026-08-01T02:00:00.000Z"); // 31 jul 8pm Managua
    assert.ok(ventaNocturna >= start && ventaNocturna < end);
  });

  it("una venta a la 1am Managua del 1 de agosto pertenece a AGOSTO", () => {
    const { start, end } = range(2026, 7);
    const madrugadaAgosto = new Date("2026-08-01T07:00:00.000Z"); // 1 ago 1am Managua
    assert.ok(!(madrugadaAgosto >= start && madrugadaAgosto < end));
  });
});
