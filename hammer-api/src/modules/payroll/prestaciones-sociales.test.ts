/**
 * Tests de prestaciones sociales según ley Nicaragua (prestaciones-sociales.ts).
 *
 * Módulo puro: se importan las funciones REALES que consume payroll-service.
 * Los valores de referencia vienen del marco legal verificado (Arts. 45, 76–82
 * y 93–99 CT; Ley 822): NO ajustar tasas/tramos aquí sin reforma de ley.
 *
 * Run: node --import tsx --test src/modules/payroll/prestaciones-sociales.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aguinaldoAccrued,
  aguinaldoPaymentDeadline,
  aguinaldoPeriodStart,
  currentVacationPeriod,
  indemnizacionAccrualRate,
  indemnizacionAccruedTotal,
  indemnizacionPayout,
  indemnizacionWithholding,
  monthsBetween,
  monthsOfService,
  vacationDaysAccrued,
  vacationPayout,
  vacationPeriodsToDate,
} from "./prestaciones-sociales";
import { computePayrollLineBreakdown, round2 } from "./payroll-nicaragua";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

// ── Antigüedad (criterio de mes fraccionado: días calendario /30) ────────────

describe("monthsOfService / monthsBetween", () => {
  it("meses calendario completos", () => {
    assert.equal(monthsBetween(utc(2026, 1, 4), utc(2026, 7, 4)), 6);
    assert.equal(monthsOfService(utc(2022, 1, 1), utc(2026, 6, 1)), 53); // 4 años 5 meses
  });

  it("fracción por días /30: del 15-mar al 30-nov son 8 meses y 15/30", () => {
    assert.equal(monthsBetween(utc(2026, 3, 15), utc(2026, 11, 30)), 8.5);
  });

  it("fecha futura o inválida → 0", () => {
    assert.equal(monthsBetween(utc(2026, 7, 1), utc(2026, 6, 1)), 0);
    assert.equal(monthsBetween(new Date("invalid"), utc(2026, 6, 1)), 0);
  });
});

// ── Indemnización por antigüedad (Art. 45 CT) ────────────────────────────────

describe("indemnizacionAccrualRate (tramos por antigüedad)", () => {
  it("mes 30 (años 1–3) → 8.333% (1/12)", () => {
    assert.equal(Math.round(indemnizacionAccrualRate(30) * 100_000) / 1000, 8.333);
  });

  it("mes 50 (años 4–6) → 5.556% ((20/30)/12)", () => {
    assert.equal(Math.round(indemnizacionAccrualRate(50) * 100_000) / 1000, 5.556);
  });

  it("mes 80 (año 7+) → 0% (tope de 5 meses alcanzado)", () => {
    assert.equal(indemnizacionAccrualRate(80), 0);
  });

  it("transición exacta: mes 36 entra al tramo de 20 días, mes 72 al tope", () => {
    assert.equal(indemnizacionAccrualRate(35.9) > indemnizacionAccrualRate(36), true);
    assert.equal(indemnizacionAccrualRate(72), 0);
  });
});

describe("indemnizacionAccruedTotal (pasivo Art. 45, tope 5 meses)", () => {
  const SALARY = 10_000;

  it("4 años 5 meses → C$39,444.42 ± 0.05 (30,000 + 6,666.67 + 2,777.75)", () => {
    const total = indemnizacionAccruedTotal(SALARY, utc(2022, 1, 1), utc(2026, 6, 1));
    assert.ok(Math.abs(total - 39_444.42) <= 0.05, `esperado ≈39,444.42, fue ${total}`);
  });

  it("6 años exactos → C$50,000 (tope: 3 + 3×(20/30) = 5 meses)", () => {
    assert.equal(indemnizacionAccruedTotal(SALARY, utc(2020, 6, 1), utc(2026, 6, 1)), 50_000);
  });

  it("8 años → C$50,000 (el tope no crece)", () => {
    assert.equal(indemnizacionAccruedTotal(SALARY, utc(2018, 6, 1), utc(2026, 6, 1)), 50_000);
  });

  it("1 año → C$10,000 (1 mes de salario)", () => {
    assert.equal(indemnizacionAccruedTotal(SALARY, utc(2025, 6, 1), utc(2026, 6, 1)), 10_000);
  });

  it("6 meses → C$5,000 (el mínimo de 1 mes aplica al PAGAR, no al pasivo)", () => {
    assert.equal(indemnizacionAccruedTotal(SALARY, utc(2026, 1, 1), utc(2026, 7, 1)), 5_000);
    assert.equal(indemnizacionPayout(SALARY, utc(2026, 1, 1), utc(2026, 7, 1)), 10_000);
  });
});

describe("indemnizacionWithholding (fiscal Ley 822)", () => {
  it("hasta 5 meses + C$500,000 es exenta; el excedente retiene 10% definitivo", () => {
    // 5 × 10,000 + 500,000 = 550,000 de techo exento.
    assert.deepEqual(indemnizacionWithholding(50_000, 10_000), { exempt: 50_000, taxable: 0, retention: 0 });
    assert.deepEqual(indemnizacionWithholding(600_000, 10_000), {
      exempt: 550_000,
      taxable: 50_000,
      retention: 5_000,
    });
  });
});

// ── Aguinaldo (Arts. 93–99 CT) ────────────────────────────────────────────────

describe("aguinaldoAccrued (período dic→nov, exento de todo)", () => {
  it("5 meses del período (dic–abr, al 30-abr) → C$4,166.67 con salario 10,000", () => {
    // Período vigente inicia el 1-dic-2025; el día `at` cuenta como trabajado.
    assert.equal(aguinaldoAccrued(10_000, utc(2024, 1, 1), utc(2026, 4, 30)), 4_166.67);
  });

  it("12 meses (período completo, al 30-nov) → un salario entero: C$10,000", () => {
    assert.equal(aguinaldoAccrued(10_000, utc(2024, 1, 1), utc(2026, 11, 30)), 10_000);
  });

  it("empleado que entró el 15-mar acumula proporcional desde el 15-mar (días/30)", () => {
    // 15-mar → 30-nov inclusive = 8 meses (15-mar→15-nov) + 16 días
    // → 8.5333 meses → 10,000 × 8.5333/12 = 7,111.11.
    assert.equal(aguinaldoAccrued(10_000, utc(2026, 3, 15), utc(2026, 11, 30)), 7_111.11);
  });

  it("el período reinicia el 1-dic: en diciembre el acumulado vuelve a empezar", () => {
    assert.equal(aguinaldoPeriodStart(utc(2026, 12, 15)).toISOString().slice(0, 10), "2026-12-01");
    assert.equal(aguinaldoPeriodStart(utc(2026, 11, 30)).toISOString().slice(0, 10), "2025-12-01");
    // 1-dic → 16-dic inclusive = 16 días → 10,000 × (16/30)/12 = 444.44.
    assert.equal(aguinaldoAccrued(10_000, utc(2024, 1, 1), utc(2026, 12, 16)), round2((10_000 * (16 / 30)) / 12));
  });

  it("fecha límite de pago: 10-dic al cierre del período", () => {
    assert.equal(aguinaldoPaymentDeadline(utc(2026, 7, 13)).toISOString().slice(0, 10), "2026-12-10");
  });
});

// ── Vacaciones (Arts. 76–82 CT) ───────────────────────────────────────────────

describe("vacaciones (2.5 días/mes, pago en dinero gravable)", () => {
  it("6 meses → 15 días acumulados", () => {
    assert.equal(vacationDaysAccrued(utc(2026, 1, 1), utc(2026, 7, 1)), 15);
  });

  it("pagar 10 días con salario 10,000 → C$3,333.33 (bruto GRAVABLE)", () => {
    assert.equal(vacationPayout(10, 10_000), 3_333.33);
  });
});

describe("vacationPeriodsToDate (acumulado POR PERÍODO de aniversario laboral)", () => {
  it("dentro del primer año: un solo período abierto, sin cortes", () => {
    const periods = vacationPeriodsToDate(utc(2026, 1, 4), utc(2026, 7, 4));
    assert.equal(periods.length, 1);
    assert.equal(periods[0].index, 0);
    assert.equal(periods[0].closed, false);
    assert.equal(periods[0].accruedDays, 15); // 6 meses × 2.5
  });

  it("año exacto cumplido: el período 0 cierra con el tope de 30 días y abre el período 1", () => {
    const periods = vacationPeriodsToDate(utc(2022, 1, 4), utc(2023, 1, 4));
    assert.equal(periods.length, 1);
    assert.equal(periods[0].closed, true);
    assert.equal(periods[0].accruedDays, 30); // 12 × 2.5, tope del período
  });

  it("4 años 6 meses: 4 períodos cerrados (30 c/u) + el 5º abierto a medio año", () => {
    const periods = vacationPeriodsToDate(utc(2022, 1, 4), utc(2026, 7, 4));
    assert.equal(periods.length, 5);
    for (let i = 0; i < 4; i++) {
      assert.equal(periods[i].closed, true, `período ${i} debería estar cerrado`);
      assert.equal(periods[i].accruedDays, 30, `período ${i} debería topar en 30`);
    }
    assert.equal(periods[4].closed, false);
    assert.equal(periods[4].accruedDays, 15); // medio año del 5º período
  });

  it("currentVacationPeriod devuelve el último período (el que sigue acumulando)", () => {
    const period = currentVacationPeriod(utc(2022, 1, 4), utc(2026, 7, 4));
    assert.equal(period?.index, 4);
    assert.equal(period?.closed, false);
    assert.equal(period?.accruedDays, 15);
  });

  it("sin servicio (fecha futura o igual al ingreso) → sin períodos", () => {
    assert.deepEqual(vacationPeriodsToDate(utc(2026, 1, 4), utc(2026, 1, 4)), []);
    assert.equal(currentVacationPeriod(utc(2026, 1, 4), utc(2025, 1, 4)), null);
  });

  it("el TOTAL acumulado por períodos es idéntico al acumulado histórico sin cortes (2.5 × meses)", () => {
    // El rediseño por período organiza el número para que sea auditable, pero
    // el pasivo total (lo que legalmente se le debe al trabajador) no cambia.
    const cases: Array<[Date, Date]> = [
      [utc(2022, 1, 4), utc(2026, 7, 13)],
      [utc(2019, 5, 1), utc(2026, 7, 13)],
      [utc(2026, 3, 15), utc(2026, 11, 30)],
    ];
    for (const [start, at] of cases) {
      const byPeriod = vacationDaysAccrued(start, at);
      const historic = round2(2.5 * monthsBetween(start, at));
      assert.equal(byPeriod, historic, `${start.toISOString()} → ${at.toISOString()}`);
    }
  });
});

// ── Integración con el desglose mensual (provisión por tramo) ────────────────

describe("provisión de indemnización por tramo en el costo mensual", () => {
  it("el neto del mes NO cambia al provisionar (costo patronal, no deducción)", () => {
    const base = computePayrollLineBreakdown({ monthlySalary: 10_000, grossSalary: 10_000, daysWorked: 30, totalDays: 30 });
    const tramo2 = computePayrollLineBreakdown({
      monthlySalary: 10_000,
      grossSalary: 10_000,
      daysWorked: 30,
      totalDays: 30,
      indemnizacionRate: indemnizacionAccrualRate(50),
    });
    assert.equal(base.netPay, tramo2.netPay);
    assert.equal(base.netPay, 9_155);
  });

  it("tramo 4–6 años provisiona (20/30)/12 y el tope provisiona 0", () => {
    const tramo2 = computePayrollLineBreakdown({
      monthlySalary: 10_000,
      grossSalary: 10_000,
      daysWorked: 30,
      totalDays: 30,
      indemnizacionRate: indemnizacionAccrualRate(50),
    });
    assert.equal(tramo2.indemnizacionAccrual, 555.56);
    const tope = computePayrollLineBreakdown({
      monthlySalary: 10_000,
      grossSalary: 10_000,
      daysWorked: 30,
      totalDays: 30,
      indemnizacionRate: indemnizacionAccrualRate(80),
    });
    assert.equal(tope.indemnizacionAccrual, 0);
    // Dos empleados con igual salario cuestan distinto según su antigüedad.
    assert.ok(tramo2.employerCost > tope.employerCost);
  });

  it("sanity 3 empleados reales: todos en tramo 1 → costo total C$46,777.50 (compatible)", () => {
    // Carolina 10,000 · 4-ene-2026; Harry 12,000 · 4-ene-2026; Marvin 9,500 · 15-mar-2026.
    const at = utc(2026, 7, 13);
    const staff = [
      { salary: 10_000, start: utc(2026, 1, 4) },
      { salary: 12_000, start: utc(2026, 1, 4) },
      { salary: 9_500, start: utc(2026, 3, 15) },
    ];
    let cost = 0;
    for (const emp of staff) {
      const rate = indemnizacionAccrualRate(monthsOfService(emp.start, at));
      assert.equal(rate, 1 / 12); // < 1 año: primer tramo para los tres
      const b = computePayrollLineBreakdown({
        monthlySalary: emp.salary,
        grossSalary: emp.salary,
        daysWorked: 30,
        totalDays: 30,
        indemnizacionRate: rate,
      });
      cost += b.employerCost;
    }
    // Mismo número que antes del desglose: confirma compatibilidad (base 31,500).
    assert.equal(round2(cost), 46_777.5);
  });

  it("pago de aguinaldo: neto == bruto (exento, no toca base INSS ni IR)", () => {
    // El aguinaldo se paga como línea EXENTA: su neto es el mismo acumulado.
    const aguinaldo = aguinaldoAccrued(10_000, utc(2024, 1, 1), utc(2026, 11, 30));
    assert.equal(aguinaldo, 10_000); // bruto del aguinaldo
    // No existe deducción aplicable: el desglose del MES no varía por pagarlo.
    const mes = computePayrollLineBreakdown({ monthlySalary: 10_000, grossSalary: 10_000, daysWorked: 30, totalDays: 30 });
    assert.equal(mes.netPay, 9_155);
  });
});
