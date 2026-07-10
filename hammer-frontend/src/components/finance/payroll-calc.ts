/**
 * Cálculo de nómina Nicaragua — espejo cliente del módulo del backend
 * (hammer-api/src/modules/payroll/payroll-nicaragua.ts).
 *
 * El panel de Planilla usa el desglose que devuelve el backend
 * (`payrollEstimate` en /api/employees); estas funciones son el FALLBACK con
 * las mismas tasas por defecto para cuando ese desglose aún no está desplegado
 * (las columnas se marcan con el badge "ESTIMADO") y para recalcular el toggle
 * de provisiones sin ir al servidor.
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

export const DEFAULT_PAYROLL_RATES: PayrollRates = {
  inssLaboralRate: 0.07,
  inssPatronalRate: 0.215,
  inatecRate: 0.02,
  provisionAguinaldo: 1 / 12,
  provisionVacaciones: 1 / 12,
  provisionIndemnizacion: 1 / 12,
  provisionsEnabled: true,
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

/** Desglose de mes completo por empleado (mismo shape que payrollEstimate del API). */
export type PayrollBreakdown = {
  inssLaboral: number;
  ir: number;
  netPay: number;
  inssPatronal: number;
  inatec: number;
  /** Provisiones SIEMPRE calculadas; el toggle del panel decide si sumarlas. */
  provisions: number;
  /** Costo empresa CON provisiones (restar `provisions` si el toggle está off). */
  employerCost: number;
};

export function computeMonthlyBreakdown(monthlySalary: number, rates: PayrollRates = DEFAULT_PAYROLL_RATES): PayrollBreakdown {
  const salary = Math.max(0, monthlySalary);
  const inssLaboral = round2(salary * rates.inssLaboralRate);
  const ir = round2(computeAnnualIr((salary - salary * rates.inssLaboralRate) * 12) / 12);
  const netPay = round2(Math.max(0, salary - inssLaboral - ir));
  const inssPatronal = round2(salary * rates.inssPatronalRate);
  const inatec = round2(salary * rates.inatecRate);
  const provisions = round2(salary * (rates.provisionAguinaldo + rates.provisionVacaciones + rates.provisionIndemnizacion));
  const employerCost = round2(salary + inssPatronal + inatec + provisions);
  return { inssLaboral, ir, netPay, inssPatronal, inatec, provisions, employerCost };
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

/**
 * Próximo pago quincenal a partir de `now`: día 15 (1ª quincena) o último día
 * del mes (2ª quincena).
 */
export function nextBiweeklyPayday(now: Date = new Date()): { label: string; date: Date; half: 1 | 2 } {
  const year = now.getFullYear();
  const month = now.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = now.getDate();
  const DIA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const build = (d: Date, half: 1 | 2) => ({
    label: `${half}ª quincena · ${DIA[d.getDay()]} ${d.getDate()} ${MES_CORTO[d.getMonth()]}`,
    date: d,
    half,
  });
  if (day <= 15) return build(new Date(year, month, 15), 1);
  return build(new Date(year, month, lastDay), 2);
}
