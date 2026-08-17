/**
 * Calendario de pago de la casa — fuente ÚNICA (prompt-planilla-calendario-quincenas.md
 * §3). El frontend consume estas fechas por API, no las recalcula.
 *
 * Reglas:
 *   1ª quincena → día 15.
 *   2ª quincena → día 30, o el último día si el mes no llega a 30 (febrero).
 *   Si la fecha cae domingo, se adelanta al sábado.
 *
 * Existía duplicado: payroll-calc.ts (frontend) aplicaba min(30, últimoDía) y
 * la regla del domingo; scheduledSecondHalf (backend) usaba el último día del
 * mes y no conocía el domingo. En agosto el usuario veía el 29 y la base
 * guardaba el 31.
 *
 * Las fechas se construyen al MEDIODÍA de America/Managua (UTC-6 fijo, sin
 * horario de verano) y se devuelven como instante UTC. new Date(year, month,
 * day) usa la hora local del PROCESO: en Vercel (UTC) el 15 a las 00:00 son
 * las 18:00 del 14 en Managua. Anclando a mediodía, ningún corte de día ni
 * husos horario puede mover la fecha al día calendario anterior.
 */

const MANAGUA_UTC_OFFSET_HOURS = 6; // UTC-6, fijo — Nicaragua no usa horario de verano.

export type PaydayHalf = 1 | 2;
export type PaydayAdjustedReason = "SUNDAY" | "SHORT_MONTH" | null;

export type PaydayResult = {
  /** Instante UTC — mediodía de Managua del día EFECTIVO de pago (ya ajustado). */
  date: Date;
  /** Día nominal: 15 o 30. */
  nominalDay: number;
  adjusted: boolean;
  adjustedReason: PaydayAdjustedReason;
};

function lastDayOfMonth(year: number, month: number): number {
  // Date.UTC(year, month, 0) = último día del mes `month` (1-indexado) porque
  // el día 0 del mes siguiente es el último del actual.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isSunday(year: number, month: number, day: number): boolean {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

function managuaNoonUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, MANAGUA_UTC_OFFSET_HOURS + 12, 0, 0));
}

/**
 * Fecha efectiva de pago de una quincena concreta, con la regla de la casa.
 * Pura en (year, month, half) — nunca depende de "hoy" ni de la hora del
 * proceso que la llama (ver nota de zona horaria arriba).
 */
export function paydayFor(year: number, month: number, half: PaydayHalf): PaydayResult {
  const lastDay = lastDayOfMonth(year, month);
  const nominalDay = half === 1 ? 15 : 30;
  let day = half === 1 ? 15 : Math.min(30, lastDay);

  let adjustedReason: PaydayAdjustedReason = null;
  if (half === 2 && lastDay < 30) adjustedReason = "SHORT_MONTH";

  // El ajuste de domingo se evalúa DESPUÉS de resolver el mes corto — si un
  // 28 de febrero cayera domingo, las dos reglas aplicarían a la vez; se
  // prioriza SUNDAY porque es el ajuste que efectivamente movió la fecha al
  // valor final.
  if (isSunday(year, month, day)) {
    day -= 1;
    adjustedReason = "SUNDAY";
  }

  return {
    date: managuaNoonUTC(year, month, day),
    nominalDay,
    adjusted: day !== nominalDay,
    adjustedReason,
  };
}

function managuaCalendarDate(instant: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Managua",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export type NextPaydayResult = PaydayResult & { half: PaydayHalf; year: number; month: number };

/**
 * Próximo pago quincenal a partir de `now`, con fecha EFECTIVA ajustada.
 * "Hoy" se resuelve en America/Managua (no en la hora local del proceso) —
 * mismo criterio que el día operativo. Si el pago ajustado de la quincena ya
 * pasó, devuelve el siguiente. Responde "¿cuál es el próximo día de pago?"
 * — una pregunta de calendario, distinta de "¿qué quincena falta pagar?"
 * (eso lo responde el estado real de los desembolsos, no el calendario).
 */
export function nextPayday(now: Date = new Date()): NextPaydayResult {
  const today = managuaCalendarDate(now);
  const todayNoonUTC = managuaNoonUTC(today.year, today.month, today.day);
  const nextMonth = today.month === 12 ? 1 : today.month + 1;
  const nextMonthYear = today.month === 12 ? today.year + 1 : today.year;

  const candidates: NextPaydayResult[] = [
    { ...paydayFor(today.year, today.month, 1), half: 1, year: today.year, month: today.month },
    { ...paydayFor(today.year, today.month, 2), half: 2, year: today.year, month: today.month },
    { ...paydayFor(nextMonthYear, nextMonth, 1), half: 1, year: nextMonthYear, month: nextMonth },
  ];

  return candidates.find((c) => c.date.getTime() >= todayNoonUTC.getTime()) ?? candidates[candidates.length - 1];
}
