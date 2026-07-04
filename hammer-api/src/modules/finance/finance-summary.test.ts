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

// ── Gastos reales del período (base caja, sin doble conteo de planilla) ──────

describe("gastos reales: caja de sucursal + planilla desembolsada", () => {
  function gastos(input: {
    cashExpensesNoPayroll: number; // EXPENSE_OUT sin vínculo a planilla
    payrollPaid: number;           // desembolsos PAID del período
    grossProfit: number;
    budgetMonthly: number;
  }) {
    const realExpenses = input.cashExpensesNoPayroll + input.payrollPaid;
    return {
      operatingExpenses: round2(realExpenses),
      operatingProfit: round2(input.grossProfit - realExpenses),
      budgetExecutionPercent: input.budgetMonthly > 0 ? Math.round((realExpenses / input.budgetMonthly) * 100) : null,
    };
  }

  it("gastos reales = egresos de caja (luz/agua/compras del momento) + planilla pagada", () => {
    const r = gastos({ cashExpensesNoPayroll: 3200, payrollPaid: 9000, grossProfit: 15000, budgetMonthly: 14000 });
    assert.equal(r.operatingExpenses, 12200);
    assert.equal(r.operatingProfit, 2800);
  });

  it("la planilla pagada por caja NO se doble-cuenta (su EXPENSE_OUT se excluye del lado caja)", () => {
    // El servicio filtra payrollDisbursements: { none: {} } en los EXPENSE_OUT,
    // así que la nómina solo entra por la línea de planilla desembolsada.
    const r = gastos({ cashExpensesNoPayroll: 500, payrollPaid: 9000, grossProfit: 10000, budgetMonthly: 0 });
    assert.equal(r.operatingExpenses, 9500); // no 18,500
  });

  it("el presupuesto configurado NO se resta de la utilidad — solo se compara", () => {
    const r = gastos({ cashExpensesNoPayroll: 1000, payrollPaid: 0, grossProfit: 5000, budgetMonthly: 20000 });
    assert.equal(r.operatingProfit, 4000); // resta 1000 real, no 20000 presupuestado
    assert.equal(r.budgetExecutionPercent, 5);
  });
});

// ── Trayectoria mensual: bucketing por mes Managua (getFinanceTrend) ─────────

describe("getFinanceTrend: índice de mes Managua (UTC-6 fijo)", () => {
  // Espejo de managuaMonthIndex del servicio.
  function managuaMonthIndex(d: Date): number {
    const shifted = new Date(d.getTime() - 6 * 3_600_000);
    return shifted.getUTCFullYear() * 12 + shifted.getUTCMonth();
  }
  const idx = (y: number, m: number) => y * 12 + (m - 1);

  it("una venta a las 8pm Managua del 31 de julio cae en el bucket de JULIO", () => {
    // 2026-08-01T02:00Z = 31 jul 8pm Managua
    assert.equal(managuaMonthIndex(new Date("2026-08-01T02:00:00.000Z")), idx(2026, 7));
  });

  it("el instante exacto del corte (06:00 UTC del día 1) abre el mes nuevo", () => {
    assert.equal(managuaMonthIndex(new Date("2026-07-01T06:00:00.000Z")), idx(2026, 7));
    assert.equal(managuaMonthIndex(new Date("2026-07-01T05:59:59.999Z")), idx(2026, 6));
  });

  it("la serie de 6 meses desde julio arranca en febrero (sin huecos)", () => {
    const endIdx = idx(2026, 7);
    const startIdx = endIdx - 5;
    assert.equal(Math.floor(startIdx / 12), 2026);
    assert.equal((startIdx % 12) + 1, 2);
    // pre-creación de buckets: exactamente 6 meses contiguos
    const months: number[] = [];
    for (let i = startIdx; i <= endIdx; i++) months.push((i % 12) + 1);
    assert.deepEqual(months, [2, 3, 4, 5, 6, 7]);
  });

  it("cruce de año: 3 meses desde enero 2027 = nov, dic 2026 y ene 2027", () => {
    const endIdx = idx(2027, 1);
    const startIdx = endIdx - 2;
    assert.equal(Math.floor(startIdx / 12), 2026);
    assert.equal((startIdx % 12) + 1, 11);
  });

  it("utilidad operativa del punto = bruta − gastos caja − planilla (mismas reglas que el resumen)", () => {
    const netSales = 10000, cogs = 6000, cashExpenses = 800, payrollPaid = 1500;
    const operatingProfit = (netSales - cogs) - cashExpenses - payrollPaid;
    assert.equal(operatingProfit, 1700);
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
