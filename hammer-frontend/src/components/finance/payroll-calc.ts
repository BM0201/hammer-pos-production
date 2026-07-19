/**
 * Cálculo de nómina Nicaragua — espejo cliente de los módulos del backend
 * (hammer-api/src/modules/payroll/payroll-nicaragua.ts y
 * prestaciones-sociales.ts).
 *
 * El panel de Planilla usa el desglose que devuelve el backend
 * (`payrollEstimate` en /api/employees); estas funciones son el FALLBACK con
 * las mismas reglas legales para cuando ese desglose aún no está desplegado
 * (las columnas se marcan con el badge "ESTIMADO") y para recalcular el
 * control de prestaciones sin ir al servidor.
 */

/* ── INSS (Decreto 06-2019): tasas por régimen y tamaño de empresa ─────────── */

export type InssRegime = "INTEGRAL" | "IVM_RP";
export type BenefitAccrualMode = "ACCRUE_MONTHLY" | "ON_PAYMENT";

export const INSS_EMPLOYER_SIZE_THRESHOLD = 50;

/** Tasas INSS según régimen y conteo GLOBAL de activos (<50 / ≥50). */
export function resolveInssRates(regime: InssRegime, activeEmployeeCount: number): { laboral: number; patronal: number } {
  const large = activeEmployeeCount >= INSS_EMPLOYER_SIZE_THRESHOLD;
  if (regime === "IVM_RP") return { laboral: 0.05, patronal: large ? 0.165 : 0.155 };
  return { laboral: 0.07, patronal: large ? 0.225 : 0.215 };
}

export type PayrollRates = {
  inssRegime: InssRegime;
  activeEmployeeCount: number;
  inatecRate: number;
  aguinaldoMode: BenefitAccrualMode;
  vacacionesMode: BenefitAccrualMode;
  indemnizacionMode: BenefitAccrualMode;
  salarioMinimoSectorial: number;
};

export const DEFAULT_PAYROLL_RATES: PayrollRates = {
  inssRegime: "INTEGRAL",
  activeEmployeeCount: 0,
  inatecRate: 0.02,
  aguinaldoMode: "ACCRUE_MONTHLY",
  vacacionesMode: "ACCRUE_MONTHLY",
  indemnizacionMode: "ACCRUE_MONTHLY",
  salarioMinimoSectorial: 0,
};

/** Tabla progresiva ANUAL del IR salarial (Ley 822), en córdobas. */
const IR_TABLE_ANNUAL = [
  { from: 0, base: 0, rate: 0.0 },
  { from: 100_000, base: 0, rate: 0.15 },
  { from: 200_000, base: 15_000, rate: 0.2 },
  { from: 350_000, base: 45_000, rate: 0.25 },
  { from: 500_000, base: 82_500, rate: 0.3 },
];

export const round2 = (v: number) => Math.round(v * 100) / 100;

function computeAnnualIr(annualTaxable: number): number {
  if (!Number.isFinite(annualTaxable) || annualTaxable <= 0) return 0;
  let bracket = IR_TABLE_ANNUAL[0];
  for (const b of IR_TABLE_ANNUAL) if (annualTaxable > b.from) bracket = b;
  return Math.max(0, bracket.base + (annualTaxable - bracket.from) * bracket.rate);
}

/* ── Prestaciones sociales (espejo de prestaciones-sociales.ts) ─────────────── */

const MS_PER_DAY = 86_400_000;

/** Meses calendario completos + días restantes /30 (criterio del backend). */
export function monthsBetween(from: Date | string, to: Date | string): number {
  const start = from instanceof Date ? from : new Date(from);
  const end = to instanceof Date ? to : new Date(to);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return 0;
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  let anchor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()));
  if (anchor > end) {
    months -= 1;
    anchor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()));
  }
  if (months < 0) return 0;
  const extraDays = Math.floor((end.getTime() - anchor.getTime()) / MS_PER_DAY);
  return months + Math.min(extraDays, 30) / 30;
}

export function monthsOfService(startDate: Date | string, at: Date = new Date()): number {
  return monthsBetween(startDate, at);
}

/** Tasa de provisión Art. 45 según antigüedad: 1/12, (20/30)/12 o 0 (tope). */
export function indemnizacionAccrualRate(months: number): number {
  if (months < 36) return 1 / 12;
  if (months < 72) return (20 / 30) / 12;
  return 0;
}

/** Pasivo acumulado Art. 45 (tope 5 meses; el mínimo de 1 mes aplica al pagar). */
export function indemnizacionAccruedTotal(monthlySalary: number, startDate: Date | string, at: Date = new Date()): number {
  const salary = Math.max(0, monthlySalary);
  const months = monthsOfService(startDate, at);
  const tramo1 = Math.min(months, 36);
  const tramo2 = Math.min(Math.max(months - 36, 0), 36);
  return round2(Math.min(salary * (tramo1 / 12) + salary * ((20 / 30) / 12) * tramo2, salary * 5));
}

/** Monto a PAGAR de indemnización al liquidar: el acumulado con piso de 1 mes (Art. 45). */
export function indemnizacionPayout(monthlySalary: number, startDate: Date | string, at: Date = new Date()): number {
  const salary = Math.max(0, monthlySalary);
  if (salary <= 0 || monthsOfService(startDate, at) <= 0) return 0;
  return round2(Math.max(indemnizacionAccruedTotal(salary, startDate, at), salary));
}

/**
 * Causales de terminación (Arts. 45/48 CT): definen si la indemnización por
 * antigüedad SE PAGA o no en la liquidación.
 */
export const SEVERANCE_CAUSALES = [
  { value: "DESPIDO_SIN_CAUSA", label: "Despido sin causa justa", paysIndemnizacion: true },
  { value: "MUTUO_ACUERDO", label: "Mutuo acuerdo", paysIndemnizacion: true },
  { value: "RENUNCIA_CON_PREAVISO", label: "Renuncia con preaviso escrito (15 días)", paysIndemnizacion: true },
  { value: "DESPIDO_CON_CAUSA", label: "Despido con causa justa (Art. 48)", paysIndemnizacion: false },
  { value: "RENUNCIA_SIN_PREAVISO", label: "Renuncia sin preaviso", paysIndemnizacion: false },
] as const;
export type SeveranceCausal = (typeof SEVERANCE_CAUSALES)[number]["value"];

/** Inicio del período legal dic→nov del aguinaldo vigente a la fecha. */
export function aguinaldoPeriodStart(at: Date = new Date()): Date {
  const year = at.getUTCMonth() === 11 ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, 11, 1));
}

/** Fecha límite legal de pago del aguinaldo: 10-dic al cierre del período. */
export function aguinaldoPaymentDeadline(at: Date = new Date()): Date {
  return new Date(Date.UTC(aguinaldoPeriodStart(at).getUTCFullYear() + 1, 11, 10));
}

/** Aguinaldo acumulado del período dic→nov (día `at` inclusive); EXENTO de todo. */
export function aguinaldoAccrued(monthlySalary: number, startDate: Date | string, at: Date = new Date()): number {
  const salary = Math.max(0, monthlySalary);
  const periodStart = aguinaldoPeriodStart(at);
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const from = start > periodStart ? start : periodStart;
  const months = Math.min(monthsBetween(from, new Date(at.getTime() + MS_PER_DAY)), 12);
  return round2((salary * months) / 12);
}

/** Días de vacaciones acumulados: 2.5 por mes trabajado. */
export function vacationDaysAccrued(startDate: Date | string, at: Date = new Date()): number {
  return round2(2.5 * monthsBetween(startDate, at));
}

/** Valor de pagar `days` de vacaciones en dinero (GRAVABLE si se paga). */
export function vacationPayout(days: number, monthlySalary: number): number {
  return round2(Math.max(0, days) * (Math.max(0, monthlySalary) / 30));
}

/* ── Desglose mensual (mismo shape que payrollEstimate del API) ─────────────── */

export type PayrollBreakdown = {
  inssLaboral: number;
  ir: number;
  netPay: number;
  inssPatronal: number;
  inatec: number;
  /** Provisiones SIEMPRE calculadas; el control del panel decide si sumarlas. */
  provisions: number;
  aguinaldoAccrual: number;
  vacacionesAccrual: number;
  indemnizacionAccrual: number;
  /** Costo empresa CON provisiones (restar `provisions` si se reconoce al pago). */
  employerCost: number;
  /** Salario por día (mensual ÷ 30) — cada falta injustificada = −1 día. */
  dailyRate?: number;
  absenceDays?: number;
  absenceDeduction?: number;
  /** Prestaciones acumuladas (pasivo por empleado) — solo cuando las sirve el API. */
  monthsOfService?: number;
  aguinaldoAccrued?: number;
  aguinaldoDeadline?: string;
  vacationDaysAccrued?: number;
  vacationDaysTaken?: number;
  vacationDaysBalance?: number;
  vacationBalanceValue?: number;
  indemnizacionAccrued?: number;
  indemnizacionRateActual?: number;
  belowMinimumWage?: boolean;
  /** Perfil del trabajador (para el drawer y la liquidación). */
  absencesMonthUnjustified?: number;
  absencesMonthJustified?: number;
  absencesYearUnjustified?: number;
  loanOutstanding?: number;
};

export function computeMonthlyBreakdown(
  monthlySalary: number,
  rates: PayrollRates = DEFAULT_PAYROLL_RATES,
  startDate?: string,
  /** Retener IR a este trabajador (varía por persona; default false como en DB). */
  applyIrRetention = false,
  /** Salario COTIZABLE reportado al INSS (≠ salario real); default = salario. */
  inssMonthlySalary?: number,
): PayrollBreakdown {
  const salary = Math.max(0, monthlySalary);
  // INSS laboral/patronal e INATEC sobre la base cotizable (como la factura);
  // prestaciones y neto sobre el salario real.
  const inssBase = Math.max(0, inssMonthlySalary ?? salary);
  const inss = resolveInssRates(rates.inssRegime, rates.activeEmployeeCount);
  const inssLaboral = round2(inssBase * inss.laboral);
  const ir = applyIrRetention ? round2(computeAnnualIr((salary - inssBase * inss.laboral) * 12) / 12) : 0;
  const netPay = round2(Math.max(0, salary - inssLaboral - ir));
  const inssPatronal = round2(inssBase * inss.patronal);
  const inatec = round2(inssBase * rates.inatecRate);

  const at = new Date();
  const months = startDate ? monthsOfService(startDate, at) : 0;
  const indemRate = indemnizacionAccrualRate(months);
  const aguiRaw = salary * (1 / 12);
  const vacRaw = salary * (2.5 / 30);
  const indemRaw = salary * indemRate;
  // Igual que el backend: la suma se redondea UNA sola vez y el último
  // componente con monto absorbe el residuo — el desglose CIERRA al centavo.
  const provisions = round2(aguiRaw + vacRaw + indemRaw);
  const aguinaldoAccrual = round2(aguiRaw);
  const vacacionesAccrual = indemRaw > 0 ? round2(vacRaw) : round2(provisions - aguinaldoAccrual);
  const indemnizacionAccrual = indemRaw > 0 ? round2(provisions - aguinaldoAccrual - vacacionesAccrual) : 0;
  const employerCost = round2(salary + inssPatronal + inatec + provisions);

  return {
    inssLaboral,
    ir,
    netPay,
    inssPatronal,
    inatec,
    provisions,
    aguinaldoAccrual,
    vacacionesAccrual,
    indemnizacionAccrual,
    employerCost,
    dailyRate: round2(salary / 30),
    ...(startDate
      ? {
          monthsOfService: round2(months),
          aguinaldoAccrued: aguinaldoAccrued(salary, startDate, at),
          aguinaldoDeadline: aguinaldoPaymentDeadline(at).toISOString().slice(0, 10),
          vacationDaysAccrued: vacationDaysAccrued(startDate, at),
          vacationDaysBalance: vacationDaysAccrued(startDate, at),
          vacationBalanceValue: vacationPayout(vacationDaysAccrued(startDate, at), salary),
          indemnizacionAccrued: indemnizacionAccruedTotal(salary, startDate, at),
          indemnizacionRateActual: indemRate,
        }
      : {}),
  };
}

/* ── Reparto quincenal (espejo de biweekly-split.ts del backend) ────────────
 * 1ª quincena = medio salario completo; las deducciones mensuales (INSS/IR/
 * préstamos, que se cobran UNA vez al mes) se descuentan en la 2ª (fin de mes).
 */
export function splitNetPayBiweekly(grossSalary: number, netPay: number): { firstHalf: number; secondHalf: number } {
  const net = Math.max(0, netPay);
  const firstHalf = round2(Math.min(round2(Math.max(0, grossSalary) / 2), net));
  return { firstHalf, secondHalf: round2(net - firstHalf) };
}

/* ── Formato ─────────────────────────────────────────────────────────────── */

export const fmtC = (v: number | string | null | undefined) =>
  `C$${Number(v ?? 0).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtC0 = (v: number) => `C$${Math.round(v).toLocaleString("es-NI")}`;

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MES_LARGO = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** "2026-01-04" → "4 ene 2026" (fechas puras: se leen en UTC para no correr de día). */
export function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MES_CORTO[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function initials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

/** "12.5%" sin ceros de relleno ("21.5%", "7%", "2%"). */
export function fmtRatePct(rate: number): string {
  const pct = rate * 100;
  return `${Number.isInteger(pct) ? pct : Math.round(pct * 10) / 10}%`;
}

/** "8.333%" con 3 decimales para tasas de prestaciones (1/12, (20/30)/12). */
export function fmtRatePct3(rate: number): string {
  return `${(Math.round(rate * 100 * 1000) / 1000).toLocaleString("es-NI", { maximumFractionDigits: 3 })}%`;
}

/** Antigüedad legible: "2 años 5 meses" / "8 meses" a partir de meses fraccionados. */
export function fmtSeniority(months: number): string {
  const whole = Math.floor(months);
  const years = Math.floor(whole / 12);
  const rest = whole % 12;
  if (years === 0) return `${rest} mes${rest === 1 ? "" : "es"}`;
  if (rest === 0) return `${years} año${years === 1 ? "" : "s"}`;
  return `${years} año${years === 1 ? "" : "s"} ${rest} mes${rest === 1 ? "" : "es"}`;
}

/* ── Próximo pago quincenal (con la regla del día hábil) ─────────────────────
 * Los pagos son el 15 y el 30. REGLA DE LA CASA:
 *  - Si el 15 o el 30 cae DOMINGO → se paga un día antes (sábado).
 *  - Si el mes termina sin 30 (febrero) → se paga el último día del mes
 *    (y si ese día cae domingo, también se adelanta al sábado).
 * Así el pago siempre sale bien y a tiempo.
 */

const DIA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export type PaydayInfo = {
  /** Ej. "2ª quincena · sáb 14 jun" (fecha EFECTIVA de pago, ya ajustada). */
  label: string;
  /** Fecha efectiva de pago (ajustada por domingo / mes corto). */
  date: Date;
  half: 1 | 2;
  /** Día nominal del pago (15 o 30). */
  baseDay: number;
  /** true si el pago se adelantó respecto al día nominal. */
  adjusted: boolean;
  /** Nota humana del ajuste (null si el pago cae en su día nominal). */
  adjustedNote: string | null;
  /** Días calendario desde hoy (0 = el pago es HOY). */
  daysUntil: number;
};

/** Fecha efectiva de pago de una quincena concreta (con la regla de la casa). */
function effectivePayday(year: number, month: number, half: 1 | 2): Omit<PaydayInfo, "label" | "daysUntil"> {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const baseDay = half === 1 ? 15 : 30;
  // Mes sin 30 (febrero): se paga el último día disponible.
  const shortMonth = half === 2 && lastDay < 30;
  let payDay = half === 1 ? 15 : Math.min(30, lastDay);
  const notes: string[] = [];
  if (shortMonth) notes.push(`el mes no tiene 30: se paga el ${payDay}`);
  // Domingo → se adelanta al sábado.
  if (new Date(year, month, payDay).getDay() === 0) {
    notes.push(`el ${payDay} cae domingo: se adelanta al sábado ${payDay - 1}`);
    payDay -= 1;
  }
  return {
    date: new Date(year, month, payDay),
    half,
    baseDay,
    adjusted: notes.length > 0,
    adjustedNote: notes.length > 0 ? notes.join("; ") : null,
  };
}

/**
 * Próximo pago quincenal a partir de `now`, con fecha EFECTIVA ajustada.
 * Si el pago ajustado de la quincena ya pasó, devuelve el siguiente.
 */
export function nextBiweeklyPayday(now: Date = new Date()): PaydayInfo {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const candidates: Array<Omit<PaydayInfo, "label" | "daysUntil">> = [
    effectivePayday(now.getFullYear(), now.getMonth(), 1),
    effectivePayday(now.getFullYear(), now.getMonth(), 2),
    effectivePayday(now.getFullYear(), now.getMonth() + 1, 1),
  ];
  const next = candidates.find((c) => c.date >= today) ?? candidates[candidates.length - 1];
  const daysUntil = Math.round((next.date.getTime() - today.getTime()) / 86_400_000);
  return {
    ...next,
    label: `${next.half}ª quincena · ${DIA[next.date.getDay()]} ${next.date.getDate()} ${MES_CORTO[next.date.getMonth()]}`,
    daysUntil,
  };
}
