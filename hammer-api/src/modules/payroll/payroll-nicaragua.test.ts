/**
 * Tests del cálculo de nómina Nicaragua (payroll-nicaragua.ts).
 *
 * A diferencia de los tests-espejo, aquí se importan las funciones REALES:
 * el módulo es puro (sin DB), así que se valida la implementación exacta que
 * consume payroll-service. Casos con la config por defecto (régimen Integral
 * <50: laboral 7%, patronal 21.5%, INATEC 2%, prestaciones provisionadas
 * 3×1/12 en el primer tramo) y tabla IR anual Ley 822.
 *
 * Run: node --import tsx --test src/modules/payroll/payroll-nicaragua.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PAYROLL_RATES,
  computeAnnualIr,
  computePayrollLineBreakdown,
  resolveInssRates,
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

// ── INSS por régimen y tamaño de empresa (Decreto 06-2019) ──────────────────

describe("resolveInssRates (régimen + conteo global de activos)", () => {
  it("Integral con 49 activos → patronal 21.5%, laboral 7%", () => {
    assert.deepEqual(resolveInssRates("INTEGRAL", 49), { laboral: 0.07, patronal: 0.215 });
  });

  it("Integral con 50 activos → patronal 22.5% (el umbral es ≥50)", () => {
    assert.deepEqual(resolveInssRates("INTEGRAL", 50), { laboral: 0.07, patronal: 0.225 });
  });

  it("IVM-RP con 49 activos → laboral 5%, patronal 15.5%", () => {
    assert.deepEqual(resolveInssRates("IVM_RP", 49), { laboral: 0.05, patronal: 0.155 });
  });

  it("IVM-RP con 50 activos → patronal 16.5%", () => {
    assert.deepEqual(resolveInssRates("IVM_RP", 50), { laboral: 0.05, patronal: 0.165 });
  });

  it("el breakdown hereda la tasa del régimen: IVM-RP retiene 5% al empleado", () => {
    const b = fullMonth(10_000, { rates: { ...DEFAULT_PAYROLL_RATES, inssRegime: "IVM_RP" } });
    assert.equal(b.inssLaboral, 500);
    assert.equal(b.inssPatronal, 1_550);
  });
});

// ── Modo de reconocimiento de prestaciones (nunca "OFF") ────────────────────

describe("prestaciones en modo ON_PAYMENT (no se provisionan en el mes)", () => {
  it("el costo empresa del mes excluye las tres provisiones", () => {
    const b = fullMonth(10_000, {
      rates: {
        ...DEFAULT_PAYROLL_RATES,
        aguinaldoMode: "ON_PAYMENT",
        vacacionesMode: "ON_PAYMENT",
        indemnizacionMode: "ON_PAYMENT",
      },
    });
    assert.equal(b.provisions, 0);
    assert.equal(b.aguinaldoAccrual, 0);
    assert.equal(b.vacacionesAccrual, 0);
    assert.equal(b.indemnizacionAccrual, 0);
    assert.equal(b.employerCost, 12_350); // 10,000 + 2,150 + 200
    // Las deducciones del empleado no cambian: prestaciones son costo patronal.
    assert.equal(b.netPay, 9_155);
  });

  it("los modos son independientes: solo aguinaldo al pago deja vac.+indemn. provisionadas", () => {
    const b = fullMonth(10_000, { rates: { ...DEFAULT_PAYROLL_RATES, aguinaldoMode: "ON_PAYMENT" } });
    assert.equal(b.aguinaldoAccrual, 0);
    assert.equal(b.vacacionesAccrual, 833.33);
    // El último componente absorbe el residuo: 833.33 + 833.34 = 1,666.67 exacto.
    assert.equal(b.indemnizacionAccrual, 833.34);
    assert.equal(b.provisions, 1_666.67);
  });

  it("provisión por defecto (tramo 1) = 3 × 1/12 ≈ 25% del bruto y CIERRA al centavo", () => {
    const b = fullMonth(10_000);
    assert.equal(b.provisions, 2_500);
    assert.equal(b.aguinaldoAccrual, 833.33);
    assert.equal(b.vacacionesAccrual, 833.33);
    // La indemnización absorbe el residuo (833.34): 833.33+833.33+833.34 = 2,500.00.
    assert.equal(b.indemnizacionAccrual, 833.34);
    assert.equal(round2(b.aguinaldoAccrual + b.vacacionesAccrual + b.indemnizacionAccrual), b.provisions);
    // Y el costo empresa es la suma exacta de sus componentes mostrados.
    assert.equal(round2(10_000 + b.inssPatronal + b.inatec + b.provisions), b.employerCost);
  });
});

// ── Base cotizable del INSS (salario reportado ≠ salario real) ───────────────

describe("inssMonthlySalary: el INSS se calcula sobre la base COTIZABLE", () => {
  it("factura real jun/2026: 2 trabajadores a C$6,519.58 → laboral 912.74 y patronal 2,803.42", () => {
    // Los trabajadores están registrados en el INSS con 6,519.58 aunque su
    // salario real sea mayor: la factura oficial se cuadra con esa base.
    const lines = [10_000, 12_000].map((salary) =>
      fullMonth(salary, { applyIrRetention: false, inssMonthlySalary: 6_519.58 }),
    );
    const laboral = round2(lines.reduce((s, l) => s + l.inssLaboral, 0));
    const patronal = round2(lines.reduce((s, l) => s + l.inssPatronal, 0));
    assert.equal(round2(lines[0].inssLaboral), 456.37); // 6,519.58 × 7%
    assert.equal(laboral, 912.74); // ✓ CUOTA LABORAL de la factura
    assert.equal(patronal, 2_803.42); // ✓ CUOTA PATRONAL de la factura (21.5%)
    assert.equal(round2(laboral + patronal), 3_716.16); // ✓ TOTAL factura INSS
  });

  it("el neto usa el salario real menos el INSS de la base cotizable", () => {
    const b = fullMonth(10_000, { applyIrRetention: false, inssMonthlySalary: 6_519.58 });
    assert.equal(b.netPay, round2(10_000 - 456.37)); // 9,543.63
  });

  it("las prestaciones NO cambian: siguen sobre el salario real", () => {
    const conBase = fullMonth(10_000, { inssMonthlySalary: 6_519.58 });
    const sinBase = fullMonth(10_000);
    assert.equal(conBase.provisions, sinBase.provisions); // 2,500 (sobre 10,000)
    assert.equal(conBase.aguinaldoAccrual, sinBase.aguinaldoAccrual);
  });

  it("sin inssMonthlySalary todo sigue igual (base = salario real)", () => {
    const b = fullMonth(10_000);
    assert.equal(b.inssLaboral, 700);
    assert.equal(b.inssPatronal, 2_150);
  });
});

// ── Faltas injustificadas (asistencia correlacionada con el pago) ────────────

describe("absenceDays: cada falta injustificada es un día de pago menos (÷30)", () => {
  it("salario 12,000 → día = 400; 2 faltas descuentan 800 del neto", () => {
    const b = fullMonth(12_000, { applyIrRetention: false, inssMonthlySalary: 6_519.58, absenceDays: 2 });
    assert.equal(b.dailyRate, 400); // 12,000 ÷ 30
    assert.equal(b.absenceDeduction, 800);
    // neto = 12,000 − 800 (faltas) − 456.37 (INSS sobre base cotizable)
    assert.equal(b.netPay, round2(12_000 - 800 - 456.37)); // 10,743.63
  });

  it("el día no trabajado tampoco es costo para el patrón", () => {
    const conFalta = fullMonth(12_000, { absenceDays: 1 });
    const sinFalta = fullMonth(12_000);
    assert.equal(round2(sinFalta.employerCost - conFalta.employerCost), 400);
  });

  it("las faltas NO cambian el INSS (se cotiza el mes completo reportado)", () => {
    const conFalta = fullMonth(12_000, { inssMonthlySalary: 6_519.58, absenceDays: 3 });
    assert.equal(conFalta.inssLaboral, 456.37);
    assert.equal(conFalta.inssPatronal, round2(6_519.58 * 0.215));
  });

  it("sin faltas todo sigue igual (absenceDeduction = 0)", () => {
    const b = fullMonth(10_000);
    assert.equal(b.absenceDays, 0);
    assert.equal(b.absenceDeduction, 0);
    assert.equal(b.dailyRate, round2(10_000 / 30));
  });

  it("las faltas se topan al bruto (no producen neto negativo)", () => {
    const b = fullMonth(10_000, { absenceDays: 45 });
    assert.equal(b.absenceDeduction, 10_000);
    assert.equal(b.netPay, 0);
  });
});

// ── Retención de IR por trabajador ───────────────────────────────────────────

describe("applyIrRetention=false (el trabajador tributa por su cuenta)", () => {
  it("no se retiene IR: neto = bruto − INSS; el costo empresa NO cambia", () => {
    const conIr = fullMonth(10_000);
    const sinIr = fullMonth(10_000, { applyIrRetention: false });
    assert.equal(sinIr.ir, 0);
    assert.equal(sinIr.netPay, 9_300); // 10,000 − 700 de INSS, nada más
    assert.equal(sinIr.totalDeductions, 700);
    // El IR es retención al empleado: quitarlo no altera lo que paga el patrón.
    assert.equal(sinIr.employerCost, conIr.employerCost);
  });

  it("los préstamos siguen deduciéndose aunque no haya IR", () => {
    const b = fullMonth(10_000, { applyIrRetention: false, loanDeductions: 1_000 });
    assert.equal(b.totalDeductions, 1_700); // INSS 700 + préstamo 1,000
    assert.equal(b.netPay, 8_300);
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
