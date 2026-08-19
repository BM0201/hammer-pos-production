/**
 * Prestaciones sociales según ley Nicaragua — módulo PURO (sin DB).
 *
 * Fórmulas de acumulación de las tres prestaciones LEGALES obligatorias:
 *  - Aguinaldo / décimo tercer mes (Arts. 93–99 CT): 1/12 por mes trabajado,
 *    período 1-dic → 30-nov, pago en los primeros 10 días de diciembre.
 *    EXENTO de todo (Art. 97): ni INSS laboral, ni IR, ni deducciones; tampoco
 *    genera INSS patronal ni INATEC.
 *  - Vacaciones (Arts. 76–82 CT): 2.5 días por mes (15 por semestre), salario
 *    diario = mensual/30. Pagadas en dinero SÍ gravan INSS laboral e IR (entran
 *    a la base imponible del mes); descansadas son salario normal.
 *  - Indemnización por antigüedad (Art. 45 CT): 1 mes/año los primeros 3 años,
 *    20 días/año del 4º al 6º, tope 5 meses (se alcanza exacto a los 6 años).
 *    Exenta de IR hasta 5 meses + C$500,000 adicionales; excedente retención
 *    definitiva 10% (Arts. 19.3 y 24.1 Ley 822). No cotiza INSS.
 *
 * Criterio de mes fraccionado (documentado en los tests): meses calendario
 * completos + días restantes / 30. Fechas por componentes UTC — startDate se
 * guarda a medianoche UTC (fecha pura), igual criterio que businessDateToYmdUTC.
 *
 * Lo consumen payroll-service (estimados por empleado) y payroll-nicaragua
 * (tasa de indemnización vigente para la provisión mensual).
 */
import {
  INDEMNIZACION_RATE_Y1_3,
  INDEMNIZACION_RATE_Y4_6,
  round2,
} from "./payroll-nicaragua";

const MS_PER_DAY = 86_400_000;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Meses de servicio entre dos fechas: meses calendario completos + fracción
 * por días calendario /30 (la transición de tramo dentro del mes se maneja
 * con esta proporcionalidad simple).
 */
export function monthsBetween(from: Date | string, to: Date | string): number {
  const start = toDate(from);
  const end = toDate(to);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return 0;

  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  let anchor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()));
  if (anchor > end) {
    months -= 1;
    anchor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()));
  }
  if (months < 0) return 0;
  const extraDays = Math.floor((end.getTime() - anchor.getTime()) / MS_PER_DAY);
  return months + Math.min(extraDays, 30) / 30;
}

/** Antigüedad del empleado en meses (fraccionados por días/30) desde startDate. */
export function monthsOfService(startDate: Date | string, at: Date = new Date()): number {
  return monthsBetween(startDate, at);
}

/* ── Indemnización por antigüedad (Art. 45 CT) ──────────────────────────────── */

/** Tope legal de la indemnización: 5 meses de salario (exacto a los 6 años). */
export const INDEMNIZACION_MAX_MONTHS = 5;
/** Exención adicional de IR para montos por convenio (Art. 19.3 Ley 822). */
export const INDEMNIZACION_EXTRA_EXEMPT_CAP = 500_000;
/** Retención definitiva sobre el excedente de la exención (Art. 24.1 Ley 822). */
export const INDEMNIZACION_EXCESS_RETENTION_RATE = 0.1;

/**
 * Tasa de provisión mensual vigente según la antigüedad (en meses):
 * años 1–3 → 1/12 (8.333%); años 4–6 → (20/30)/12 (5.556%); año 7+ → 0
 * (el tope de 5 meses ya se alcanzó y el pasivo no crece).
 */
export function indemnizacionAccrualRate(months: number): number {
  if (months < 36) return INDEMNIZACION_RATE_Y1_3;
  if (months < 72) return INDEMNIZACION_RATE_Y4_6;
  return 0;
}

/**
 * Pasivo acumulado Art. 45 a la fecha: 1/12 del salario por los primeros 36
 * meses + (20/30)/12 por los meses 37–72, topado en 5 meses de salario.
 * OJO: el "mínimo 1 mes" del Art. 45 aplica AL PAGAR la liquidación
 * (indemnizacionPayout), no al pasivo acumulado — 6 meses de servicio
 * acumulan medio mes, pero si se liquida se paga 1 mes completo.
 */
export function indemnizacionAccruedTotal(
  monthlySalary: number,
  startDate: Date | string,
  at: Date = new Date(),
): number {
  const salary = Math.max(0, monthlySalary);
  const months = monthsOfService(startDate, at);
  const tramo1Months = Math.min(months, 36);
  const tramo2Months = Math.min(Math.max(months - 36, 0), 36);
  const accrued = salary * INDEMNIZACION_RATE_Y1_3 * tramo1Months + salary * INDEMNIZACION_RATE_Y4_6 * tramo2Months;
  return round2(Math.min(accrued, salary * INDEMNIZACION_MAX_MONTHS));
}

/**
 * Monto a PAGAR en liquidación (si la causal da derecho — Art. 45/48; esa
 * decisión no es de este módulo): el acumulado con el piso legal de 1 mes.
 */
export function indemnizacionPayout(monthlySalary: number, startDate: Date | string, at: Date = new Date()): number {
  const salary = Math.max(0, monthlySalary);
  if (salary <= 0 || monthsOfService(startDate, at) <= 0) return 0;
  return round2(Math.max(indemnizacionAccruedTotal(salary, startDate, at), salary));
}

/**
 * Tratamiento fiscal del pago de indemnización: exenta hasta 5 meses de
 * salario + C$500,000 adicionales; el excedente lleva retención DEFINITIVA
 * del 10% (no entra a la base mensual de IR). No cotiza INSS.
 */
export function indemnizacionWithholding(totalPayout: number, monthlySalary: number) {
  const payout = Math.max(0, totalPayout);
  const exemptCap = Math.max(0, monthlySalary) * INDEMNIZACION_MAX_MONTHS + INDEMNIZACION_EXTRA_EXEMPT_CAP;
  const taxable = Math.max(0, payout - exemptCap);
  const retention = round2(taxable * INDEMNIZACION_EXCESS_RETENTION_RATE);
  return { exempt: round2(Math.min(payout, exemptCap)), taxable: round2(taxable), retention };
}

/* ── Aguinaldo / décimo tercer mes (Arts. 93–99 CT) ─────────────────────────── */

/** Inicio del período legal dic→nov vigente a la fecha `at` (1-dic anterior). */
export function aguinaldoPeriodStart(at: Date = new Date()): Date {
  const year = at.getUTCMonth() === 11 ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, 11, 1));
}

/** Fecha límite de pago del período vigente: 10-dic al cierre (30-nov). */
export function aguinaldoPaymentDeadline(at: Date = new Date()): Date {
  const periodStart = aguinaldoPeriodStart(at);
  return new Date(Date.UTC(periodStart.getUTCFullYear() + 1, 11, 10));
}

/**
 * Aguinaldo acumulado del período dic→nov vigente: 1/12 del salario por mes
 * trabajado desde max(startDate, 1-dic anterior). Meses fraccionados por
 * días/30 (empleado que entró el 15 de marzo acumula desde el 15 de marzo).
 * El día `at` cuenta como TRABAJADO (conteo inclusivo): al 30-nov el período
 * completo devenga 12/12 exactos — a diferencia de monthsOfService, donde la
 * antigüedad se cumple al terminar el día anterior.
 * Base: último salario mensual ordinario (si el salario fuera variable, la ley
 * manda el más alto de los últimos 6 meses; el sistema maneja salario fijo).
 * EXENTO de INSS/IR/deducciones — neto del aguinaldo === bruto (Art. 97).
 */
export function aguinaldoAccrued(monthlySalary: number, startDate: Date | string, at: Date = new Date()): number {
  const salary = Math.max(0, monthlySalary);
  const periodStart = aguinaldoPeriodStart(at);
  const start = toDate(startDate);
  const from = start > periodStart ? start : periodStart;
  const inclusiveEnd = new Date(at.getTime() + MS_PER_DAY);
  const months = Math.min(monthsBetween(from, inclusiveEnd), 12);
  return round2((salary * months) / 12);
}

/* ── Vacaciones (Arts. 76–82 CT) ────────────────────────────────────────────── */

/** Días de vacación acumulados por mes trabajado (2.5 = 15 por semestre). */
export const VACATION_DAYS_PER_MONTH = 2.5;

export type VacationPeriod = {
  /** 0 = primer año de servicio, 1 = segundo año, etc. */
  index: number;
  /** Inicio del período (aniversario laboral de ese año). */
  start: Date;
  /** Fin del período (exclusivo) — el siguiente aniversario. */
  end: Date;
  /** Días acumulados EN ESTE período a la fecha `at` (tope 30 si ya cerró). */
  accruedDays: number;
  /** true si el período ya se completó (12 meses cumplidos, ya no acumula más). */
  closed: boolean;
};

function addMonthsUTC(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

/**
 * Desglosa el servicio en PERÍODOS DE ANIVERSARIO LABORAL (bloques de 12
 * meses desde `startDate`), cada uno con lo acumulado a la fecha. Reemplaza el
 * acumulado histórico "de por vida" (2.5 × meses totales sin cortes): el total
 * es matemáticamente el mismo, pero ahora se puede auditar año por año — "año
 * 3: 18.5/30 días" en vez de un número gigante sin forma de verificar si está
 * bien. Práctica estándar de nómina en vez de un acumulado sin cortes.
 */
export function vacationPeriodsToDate(startDate: Date | string, at: Date = new Date()): VacationPeriod[] {
  const start = toDate(startDate);
  if (isNaN(start.getTime()) || at <= start) return [];

  const periods: VacationPeriod[] = [];
  let periodStart = start;
  let index = 0;
  while (periodStart < at) {
    const periodEnd = addMonthsUTC(start, (index + 1) * 12);
    const closed = at >= periodEnd;
    const monthsInPeriod = closed ? 12 : monthsBetween(periodStart, at);
    periods.push({
      index,
      start: periodStart,
      end: periodEnd,
      accruedDays: round2(Math.min(monthsInPeriod, 12) * VACATION_DAYS_PER_MONTH),
      closed,
    });
    periodStart = periodEnd;
    index++;
  }
  return periods;
}

/** El período de aniversario laboral EN CURSO (el último, aún abierto). */
export function currentVacationPeriod(startDate: Date | string, at: Date = new Date()): VacationPeriod | null {
  const periods = vacationPeriodsToDate(startDate, at);
  return periods.length > 0 ? periods[periods.length - 1] : null;
}

/**
 * Días acumulados TOTALES a la fecha: suma de todos los períodos de
 * aniversario (mismo total que 2.5 × meses de servicio — los períodos
 * particionan el tiempo sin huecos ni solapes, solo lo organizan por año).
 */
export function vacationDaysAccrued(startDate: Date | string, at: Date = new Date()): number {
  const periods = vacationPeriodsToDate(startDate, at);
  return round2(periods.reduce((sum, p) => sum + p.accruedDays, 0));
}

/**
 * Valor en córdobas de pagar `days` de vacaciones EN DINERO: días × salario/30.
 * GRAVABLE: entra a la base de INSS laboral e IR del mes en que se paga
 * (las vacaciones descansadas, en cambio, son salario normal del período).
 */
export function vacationPayout(days: number, monthlySalary: number): number {
  return round2(Math.max(0, days) * (Math.max(0, monthlySalary) / 30));
}
