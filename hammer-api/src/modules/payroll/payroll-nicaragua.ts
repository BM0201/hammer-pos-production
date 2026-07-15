/**
 * Cálculo de nómina de Nicaragua — módulo PURO (sin DB).
 *
 * Fuente única de las fórmulas legales:
 *  - INSS (Decreto 06-2019): tasas laboral/patronal POR RÉGIMEN (Integral o
 *    IVM-RP) y por tamaño de empresa (<50 / ≥50 trabajadores activos, conteo
 *    GLOBAL de la empresa, no por sucursal). Sin techo de cotización.
 *  - INATEC: 2% patronal sobre planilla bruta (ambos regímenes), constante.
 *  - IR salarial (tabla progresiva ANUAL del art. 23, Ley 822) — constante
 *    versionada en código, NO en DB: la tarifa solo cambia por reforma de ley.
 *  - Prestaciones sociales OBLIGATORIAS (aguinaldo Arts. 93–99 CT, vacaciones
 *    Arts. 76–82 CT, indemnización Art. 45 CT): cada una con su modo de
 *    reconocimiento (provisión mensual o al pago) — NUNCA desactivables.
 *    Las fórmulas de acumulación viven en prestaciones-sociales.ts.
 *
 * Lo consume payroll-service (persistencia por PayrollLine) y los tests
 * unitarios importan estas mismas funciones (convención del repo: lógica de
 * cálculo pura y testeable sin base de datos).
 */

/* ── INSS (Decreto 06-2019, vigente desde feb 2019) ─────────────────────────── */

export type InssRegime = "INTEGRAL" | "IVM_RP";

export const INSS_INTEGRAL_LABORAL = 0.07;
export const INSS_INTEGRAL_PATRONAL_LT50 = 0.215;
export const INSS_INTEGRAL_PATRONAL_GTE50 = 0.225;
export const INSS_IVM_RP_LABORAL = 0.05;
export const INSS_IVM_RP_PATRONAL_LT50 = 0.155;
export const INSS_IVM_RP_PATRONAL_GTE50 = 0.165;

/** INATEC: 2% patronal sobre planilla bruta, ambos regímenes (constante legal). */
export const INATEC_RATE = 0.02;

/** Umbral de trabajadores activos que cambia la tasa patronal (≥50 sube). */
export const INSS_EMPLOYER_SIZE_THRESHOLD = 50;

/**
 * Tasas INSS vigentes según régimen y tamaño de empresa. El conteo de activos
 * es GLOBAL (todas las sucursales): la tasa por tamaño aplica a toda la
 * planilla, no por sucursal.
 */
export function resolveInssRates(
  regime: InssRegime,
  activeEmployeeCount: number,
): { laboral: number; patronal: number } {
  const large = activeEmployeeCount >= INSS_EMPLOYER_SIZE_THRESHOLD;
  if (regime === "IVM_RP") {
    return { laboral: INSS_IVM_RP_LABORAL, patronal: large ? INSS_IVM_RP_PATRONAL_GTE50 : INSS_IVM_RP_PATRONAL_LT50 };
  }
  return { laboral: INSS_INTEGRAL_LABORAL, patronal: large ? INSS_INTEGRAL_PATRONAL_GTE50 : INSS_INTEGRAL_PATRONAL_LT50 };
}

/* ── Prestaciones sociales: modos de reconocimiento ─────────────────────────── */

/**
 * Aguinaldo, vacaciones e indemnización son obligaciones LEGALES: no existe un
 * modo "OFF". Solo cambia CUÁNDO se reflejan en el costo mensual:
 *  - ACCRUE_MONTHLY: se provisiona la fracción del mes (1/12, 2.5 días, tramo
 *    Art. 45) dentro del costo empresa.
 *  - ON_PAYMENT: el gasto se reconoce al pagar (diciembre / goce / liquidación).
 */
export type BenefitAccrualMode = "ACCRUE_MONTHLY" | "ON_PAYMENT";

/** Aguinaldo: 1/12 del salario mensual por mes trabajado (Art. 93 CT). */
export const AGUINALDO_MONTHLY_RATE = 1 / 12;
/** Vacaciones: 2.5 días/mes × (salario/30) = 1/12 del salario (Art. 76 CT). */
export const VACACIONES_MONTHLY_RATE = 2.5 / 30;
/** Indemnización Art. 45, años 1–3: 1 mes por año → 1/12 mensual. */
export const INDEMNIZACION_RATE_Y1_3 = 1 / 12;
/** Indemnización Art. 45, años 4–6: 20 días por año → (20/30)/12 mensual. */
export const INDEMNIZACION_RATE_Y4_6 = 20 / 30 / 12;

/* ── Configuración de nómina (PayrollRateConfig + conteo global) ────────────── */

export type PayrollRates = {
  inssRegime: InssRegime;
  /** Trabajadores activos de TODA la empresa (define la tasa patronal). */
  activeEmployeeCount: number;
  inatecRate: number;
  aguinaldoMode: BenefitAccrualMode;
  vacacionesMode: BenefitAccrualMode;
  indemnizacionMode: BenefitAccrualMode;
  /** Salario mínimo sectorial: solo para ADVERTIR salarios por debajo (no bloquea). */
  salarioMinimoSectorial: number;
};

/** Config por defecto: régimen Integral, empresa <50, todo provisionado mensual. */
export const DEFAULT_PAYROLL_RATES: PayrollRates = {
  inssRegime: "INTEGRAL",
  activeEmployeeCount: 0,
  inatecRate: INATEC_RATE,
  aguinaldoMode: "ACCRUE_MONTHLY",
  vacacionesMode: "ACCRUE_MONTHLY",
  indemnizacionMode: "ACCRUE_MONTHLY",
  salarioMinimoSectorial: 0,
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
  /**
   * Tasa de provisión de indemnización vigente para ESTE empleado según su
   * antigüedad (indemnizacionAccrualRate en prestaciones-sociales.ts):
   * 1/12 (años 1–3), (20/30)/12 (años 4–6) o 0 (tope de 5 meses alcanzado).
   * Sin dato de antigüedad se asume el primer tramo.
   */
  indemnizacionRate?: number;
  /**
   * Retener IR salarial a este empleado (Employee.applyIrRetention). Varía
   * POR TRABAJADOR: quienes tributan por su cuenta no llevan retención.
   * Default true a nivel de función (la fórmula legal completa); en la
   * práctica el flag del empleado decide, y su default en DB es false.
   */
  applyIrRetention?: boolean;
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
  /** Provisión del mes de aguinaldo (0 si aguinaldoMode=ON_PAYMENT). */
  aguinaldoAccrual: number;
  /** Provisión del mes de vacaciones (0 si vacacionesMode=ON_PAYMENT). */
  vacacionesAccrual: number;
  /** Provisión del mes de indemnización según tramo (0 si ON_PAYMENT o tope). */
  indemnizacionAccrual: number;
  /** Suma de las tres provisiones del período (compatibilidad con snapshots). */
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
 *
 * Prestaciones: son costo PATRONAL — nunca tocan el neto del empleado. El
 * aguinaldo y la indemnización NO generan INSS patronal ni INATEC sobre sí
 * mismos (Art. 97 CT / Art. 19.3 Ley 822): las cargas se calculan solo sobre
 * el salario bruto.
 */
export function computePayrollLineBreakdown(input: PayrollLineBreakdownInput): PayrollLineBreakdown {
  const rates = input.rates ?? DEFAULT_PAYROLL_RATES;
  const inss = resolveInssRates(rates.inssRegime, rates.activeEmployeeCount);
  const grossSalary = Math.max(0, input.grossSalary);
  const monthlySalary = Math.max(0, input.monthlySalary);
  const loanDeductions = round2(Math.max(0, input.loanDeductions ?? 0));
  const otherDeductions = round2(Math.max(0, input.otherDeductions ?? 0));

  const prorationFactor = input.totalDays > 0 ? Math.min(1, Math.max(0, input.daysWorked / input.totalDays)) : 1;

  const inssLaboral = round2(grossSalary * inss.laboral);

  // IR solo si a ESTE empleado se le retiene (varía por trabajador: quien
  // tributa por su cuenta no lleva retención y su neto = bruto − INSS − préstamos).
  const applyIr = input.applyIrRetention ?? true;
  const fullMonthInss = monthlySalary * inss.laboral;
  const irMonthlyFull = applyIr ? computeAnnualIr((monthlySalary - fullMonthInss) * 12) / 12 : 0;
  const ir = round2(irMonthlyFull * prorationFactor);

  const totalDeductions = round2(inssLaboral + ir + loanDeductions + otherDeductions);
  const netPay = round2(Math.max(0, grossSalary - totalDeductions));

  const inssPatronal = round2(grossSalary * inss.patronal);
  const inatec = round2(grossSalary * rates.inatecRate);

  const indemnizacionRate = input.indemnizacionRate ?? INDEMNIZACION_RATE_Y1_3;
  // CIERRE EXACTO: la suma se redondea UNA sola vez (3 × 10,000/12 = 2,500.00,
  // números históricos intactos) y el ÚLTIMO componente con monto absorbe el
  // residuo de redondeo, de modo que aguinaldo + vacaciones + indemnización
  // === provisions al centavo (la UI y el CSV cierran sin descuadres).
  const aguinaldoRaw = rates.aguinaldoMode === "ACCRUE_MONTHLY" ? grossSalary * AGUINALDO_MONTHLY_RATE : 0;
  const vacacionesRaw = rates.vacacionesMode === "ACCRUE_MONTHLY" ? grossSalary * VACACIONES_MONTHLY_RATE : 0;
  const indemnizacionRaw = rates.indemnizacionMode === "ACCRUE_MONTHLY" ? grossSalary * indemnizacionRate : 0;

  const provisions = round2(aguinaldoRaw + vacacionesRaw + indemnizacionRaw);
  let aguinaldoAccrual = round2(aguinaldoRaw);
  let vacacionesAccrual = round2(vacacionesRaw);
  let indemnizacionAccrual = round2(indemnizacionRaw);
  if (indemnizacionRaw > 0) {
    indemnizacionAccrual = round2(provisions - aguinaldoAccrual - vacacionesAccrual);
  } else if (vacacionesRaw > 0) {
    vacacionesAccrual = round2(provisions - aguinaldoAccrual - indemnizacionAccrual);
  } else if (aguinaldoRaw > 0) {
    aguinaldoAccrual = round2(provisions - vacacionesAccrual - indemnizacionAccrual);
  }

  // Costo empresa = suma EXACTA de los componentes ya redondeados (cierra
  // contra lo que se muestra: salario + patronal + INATEC + provisiones).
  const employerCost = round2(round2(grossSalary) + inssPatronal + inatec + provisions);

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
    aguinaldoAccrual,
    vacacionesAccrual,
    indemnizacionAccrual,
    provisions,
    employerCost,
  };
}
