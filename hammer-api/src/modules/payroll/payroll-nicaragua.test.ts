/**
 * Tests del cálculo de nómina Nicaragua (payroll-nicaragua.ts).
 *
 * A diferencia de los tests-espejo, aquí se importan las funciones REALES:
 * el módulo es puro (sin DB), así que se valida la implementación exacta que
 * consume payroll-service. Casos con tasas por defecto (INSS laboral 7%,
 * patronal 21.5%, INATEC 2%, provisiones 3×1/12) y tabla IR anual Ley 822.
 *
 * Run: node --import tsx --test src/modules/payroll/payroll-nicaragua.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PAYROLL_RATES,
  computeAnnualIr,
  computePayrollLineBreakdown,
  provisionsRateSum,
  round2,
} from "./payroll-nicaragua";

function fullMonth(monthlySalary: number, overrides: Partial<Parameters<typeof computePayrollLineBreakdown>[0]> = {}) {
  return computePayrollLineBreakdown({
    monthlySalary,
    grossSalary: monthlySalary,
    daysWorked: 30,
    totalDays: 30,
    ...overrides,
  });
}

// ── Tabla IR anual (Ley 822, art. 23) ────────────────────────────────────────

describe("computeAnnualIr (tabla progresiva anual Ley 822)", () => {
  it("hasta 100,000 anuales está exento", () => {
    assert.equal(computeAnnualIr(0), 0);
    assert.equal(computeAnnualIr(100_000), 0);
  });

  it("tramo 15%: sobre el exceso de 100,000", () => {
    assert.equal(computeAnnualIr(150_000), 7_500);
    assert.equal(computeAnnualIr(200_000), 15_000);
  });

  it("tramo 20%: C$15,000 + 20% sobre exceso de 200,000", () => {
    assert.equal(computeAnnualIr(300_000), 15_000 + 20_000);
  });

  it("tramo 25%: C$45,000 + 25% sobre exceso de 350,000", () => {
    assert.equal(computeAnnualIr(400_000), 45_000 + 12_500);
  });

  it("tramo 30%: C$82,500 + 30% sobre exceso de 500,000", () => {
    assert.equal(computeAnnualIr(600_000), 82_500 + 30_000);
  });

  it("renta negativa o inválida → 0", () => {
    assert.equal(computeAnnualIr(-5_000), 0);
    assert.equal(computeAnnualIr(NaN), 0);
  });
});

// ── Casos exactos del rediseño (mes completo, provisiones activas) ───────────

describe("computePayrollLineBreakdown — casos exactos (tasas por defecto)", () => {
  it("salario 10,000 → INSS 700.00, IR 145.00, neto 9,155.00, costo empresa 14,850.00", () => {
    const b = fullMonth(10_000);
    assert.equal(b.inssLaboral, 700);
    assert.equal(b.ir, 145);
    assert.equal(b.netPay, 9_155);
    assert.equal(b.inssPatronal, 2_150);
    assert.equal(b.inatec, 200);
    assert.equal(b.provisions, 2_500);
    assert.equal(b.employerCost, 14_850);
  });

  it("salario 12,000 → INSS 840.00, IR 424.00, neto 10,736.00, costo empresa 17,820.00", () => {
    const b = fullMonth(12_000);
    assert.equal(b.inssLaboral, 840);
    assert.equal(b.ir, 424);
    assert.equal(b.netPay, 10_736);
    assert.equal(b.employerCost, 17_820);
  });

  it("salario 9,500 → INSS 665.00, IR 75.25, neto 8,759.75, costo empresa 14,107.50", () => {
    const b = fullMonth(9_500);
    assert.equal(b.inssLaboral, 665);
    assert.equal(b.ir, 75.25);
    assert.equal(b.netPay, 8_759.75);
    assert.equal(b.employerCost, 14_107.5);
  });

  it("totales de los 3 empleados: base 31,500.00, neto 28,650.75, costo 46,777.50 (+48.5% sobre base)", () => {
    const lines = [10_000, 12_000, 9_500].map((s) => fullMonth(s));
    const base = round2(lines.reduce((sum, l) => sum + l.grossSalary, 0));
    const net = round2(lines.reduce((sum, l) => sum + l.netPay, 0));
    const cost = round2(lines.reduce((sum, l) => sum + l.employerCost, 0));
    assert.equal(base, 31_500);
    assert.equal(net, 28_650.75);
    assert.equal(cost, 46_777.5);
    assert.equal(Math.round((cost / base - 1) * 1000) / 10, 48.5);
  });
});

// ── Provisiones desactivadas ──────────────────────────────────────────────────

describe("provisiones desactivadas (provisionsEnabled=false)", () => {
  it("el costo empresa excluye aguinaldo/vacaciones/indemnización", () => {
    const b = fullMonth(10_000, { rates: { ...DEFAULT_PAYROLL_RATES, provisionsEnabled: false } });
    assert.equal(b.provisions, 0);
    assert.equal(b.employerCost, 12_350); // 10,000 + 2,150 + 200
    // Las deducciones del empleado no cambian: provisiones son costo patronal.
    assert.equal(b.netPay, 9_155);
  });

  it("suma de provisiones por defecto = 3 × 1/12 = 25%", () => {
    assert.equal(round2(provisionsRateSum(DEFAULT_PAYROLL_RATES) * 100), 25);
  });
});

// ── Prorrateo por días trabajados ─────────────────────────────────────────────

describe("salario prorrateado (daysWorked < totalDays)", () => {
  it("15/30 días: bruto, INSS, IR y cargas se prorratean a la mitad", () => {
    // El IR se calcula sobre el mes COMPLETO y luego se prorratea igual que el
    // salario (anualizar el bruto prorrateado sesgaría el tramo hacia abajo).
    const b = computePayrollLineBreakdown({
      monthlySalary: 10_000,
      grossSalary: 5_000,
      daysWorked: 15,
      totalDays: 30,
    });
    assert.equal(b.inssLaboral, 350); // 7% del bruto prorrateado
    assert.equal(b.ir, 72.5); // 145.00 × (15/30)
    assert.equal(b.netPay, 4_577.5);
    assert.equal(b.inssPatronal, 1_075);
    assert.equal(b.inatec, 100);
    assert.equal(b.provisions, 1_250);
    assert.equal(b.employerCost, 7_425); // exactamente la mitad de 14,850
  });

  it("mes completo y prorrateo 30/30 dan el mismo resultado", () => {
    const full = fullMonth(9_500);
    const prorated = computePayrollLineBreakdown({
      monthlySalary: 9_500,
      grossSalary: 9_500,
      daysWorked: 30,
      totalDays: 30,
    });
    assert.deepEqual(prorated, full);
  });
});

// ── Deducciones y límites ────────────────────────────────────────────────────

describe("deducciones (préstamos/otras) y neto nunca negativo", () => {
  it("los préstamos se restan del neto y entran al total de deducciones", () => {
    const b = fullMonth(10_000, { loanDeductions: 1_000 });
    assert.equal(b.totalDeductions, 700 + 145 + 1_000);
    assert.equal(b.netPay, 8_155);
  });

  it("el neto se topa en 0 aunque las deducciones excedan el bruto", () => {
    const b = fullMonth(10_000, { loanDeductions: 20_000 });
    assert.equal(b.netPay, 0);
  });

  it("salario bajo el techo exento no paga IR", () => {
    // 8,000 × 93% × 12 = 89,280 anuales < 100,000 → IR 0
    const b = fullMonth(8_000);
    assert.equal(b.ir, 0);
    assert.equal(b.netPay, 8_000 - 560);
  });
});
