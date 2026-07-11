/**
 * Cálculo de nómina de Nicaragua — módulo PURO (sin DB).
 *
 * Fuente única de las fórmulas legales:
 *  - INSS laboral (retención al empleado, 7% por defecto)
 *  - IR salarial (tabla progresiva ANUAL del art. 23, Ley 822) — constante
 *    versionada en código, NO en DB: la tarifa solo cambia por reforma de ley.
 *  - Cargas patronales: INSS patronal (régimen integral, <50 empleados: 21.5%,
 *    editable vía PayrollRateConfig) + INATEC (2%).
 *  - Provisiones: aguinaldo, vacaciones e indemnización (1/12 c/u), activables.
 *
 * Lo consume payroll-service (persistencia por PayrollLine) y los tests
 * unitarios importan estas mismas funciones (convención del repo: lógica de
 * cálculo pura y testeable sin base de datos).
 */

export type PayrollRates = {
  inssLaboralRate: number;
  inssPatronalRate: number;
  inatecRate: number;
  provisionAguinaldo: number;
  provisionVacaciones: number;
  provisionIndemnizacion: number;
  provisionsEnabled: boolean;
};

/** Tasas por defecto (régimen integral, empleador con <50 empleados). */
export const DEFAULT_PAYROLL_RATES: PayrollRates = {
  inssLaboralRate: 0.07,
  inssPatronalRate: 0.215,
  inatecRate: 0.02,
  provisionAguinaldo: 1 / 12,
  provisionVacaciones: 1 / 12,
  provisionIndemnizacion: 1 / 12,
  provisionsEnabled: true,
};

/**
 * Tabla progresiva ANUAL del IR salarial (Ley 822, art. 23), en córdobas.
 * `base` es el impuesto acumulado de los tramos anteriores; `rate` aplica
 * sobre el exceso de `from`.
 */
export type IrBracket = { from: number; base: number; rate: number };

export const IR_TABLE_ANNUAL: readonly IrBracket[] = [
  { from: 0, base: 0, rate: 0.0 },
  { from: 100_000, base: 0, rate: 0.15 },
  { from: 200_000, base: 15_000, rate: 0.2 },
  { from: 350_000, base: 45_000, rate: 0.25 },
  { from: 500_000, base: 82_500, rate: 0.3 },
];

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** IR anual según la tabla progresiva para una renta neta anual dada. */
export function computeAnnualIr(annualTaxable: number): number {
  if (!Number.isFinite(annualTaxable) || annualTaxable <= 0) return 0;
  let bracket = IR_TABLE_ANNUAL[0];
  for (const b of IR_TABLE_ANNUAL) {
    if (annualTaxable > b.from) bracket = b;
  }
  return Math.max(0, bracket.base + (annualTaxable - bracket.from) * bracket.rate);
}

/** Suma de tasas de provisiones (aguinaldo + vacaciones + indemnización). */
export function provisionsRateSum(rates: PayrollRates): number {
  return rates.provisionAguinaldo + rates.provisionVacaciones + rates.provisionIndemnizacion;
}

export type PayrollLineBreakdownInput = {
  /** Salario mensual completo (base para anualizar el IR). */
  monthlySalary: number;
  /** Salario bruto del período, YA prorrateado por días trabajados. */
  grossSalary: number;
  daysWorked: number;
  totalDays: number;
  loanDeductions?: number;
  otherDeductions?: number;
  rates?: PayrollRates;
};

export type PayrollLineBreakdown = {
  grossSalary: number;
  /** Retención INSS laboral (sobre el bruto prorrateado). */
  inssLaboral: number;
  /** IR mensual (Ley 822), prorrateado igual que el salario. */
  ir: number;
  loanDeductions: number;
  otherDeductions: number;
  /** Total de deducciones de la línea = INSS laboral + IR + préstamos + otras. */
  totalDeductions: number;
  /** Neto a pagar (nunca negativo). */
  netPay: number;
  inssPatronal: number;
  inatec: number;
  /** Provisiones del período (0 si provisionsEnabled=false). */
  provisions: number;
  /** Costo total empresa = bruto + patronal + INATEC + provisiones. */
  employerCost: number;
};

/**
 * Desglose completo de una línea de nómina.
 *
 * IR: se calcula sobre el mes COMPLETO — IR_anual((salario − INSS laboral) × 12) / 12 —
 * y luego se prorratea por días trabajados, igual que el salario. Anualizar el
 * bruto ya prorrateado sesgaría el tramo de la tabla hacia abajo en meses parciales.
 */
export function computePayrollLineBreakdown(input: PayrollLineBreakdownInput): PayrollLineBreakdown {
  const rates = input.rates ?? DEFAULT_PAYROLL_RATES;
  const grossSalary = Math.max(0, input.grossSalary);
  const monthlySalary = Math.max(0, input.monthlySalary);
  const loanDeductions = round2(Math.max(0, input.loanDeductions ?? 0));
  const otherDeductions = round2(Math.max(0, input.otherDeductions ?? 0));

  const prorationFactor = input.totalDays > 0 ? Math.min(1, Math.max(0, input.daysWorked / input.totalDays)) : 1;

  const inssLaboral = round2(grossSalary * rates.inssLaboralRate);

  const fullMonthInss = monthlySalary * rates.inssLaboralRate;
  const irMonthlyFull = computeAnnualIr((monthlySalary - fullMonthInss) * 12) / 12;
  const ir = round2(irMonthlyFull * prorationFactor);

  const totalDeductions = round2(inssLaboral + ir + loanDeductions + otherDeductions);
  const netPay = round2(Math.max(0, grossSalary - totalDeductions));

  const inssPatronal = round2(grossSalary * rates.inssPatronalRate);
  const inatec = round2(grossSalary * rates.inatecRate);
  const provisions = rates.provisionsEnabled ? round2(grossSalary * provisionsRateSum(rates)) : 0;
  const employerCost = round2(grossSalary + inssPatronal + inatec + provisions);

  return {
    grossSalary: round2(grossSalary),
    inssLaboral,
    ir,
    loanDeductions,
    otherDeductions,
    totalDeductions,
    netPay,
    inssPatronal,
    inatec,
    provisions,
    employerCost,
  };
}
