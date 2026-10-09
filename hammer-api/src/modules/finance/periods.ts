import {
  OPERATIONAL_TIMEZONE,
  businessDateFromInstant,
  operationalWindow,
  weekStartForBusinessDate,
} from "@/modules/operations/business-date";

/**
 * prompt-gastos-semana-quincena.md Fase 2.1 — períodos de Finanzas (semana,
 * quincena, mes), puros y en hora de Managua. Reusa businessDateFromInstant/
 * operationalWindow/weekStartForBusinessDate (operations/business-date.ts —
 * ya resuelven "día calendario de Managua" y "semana lunes-domingo" para el
 * Día Operativo) en vez de reimplementar la zona horaria desde cero.
 *
 * `start`/`end` son siempre [start, end) — medianoche Managua expresada en
 * UTC (6 horas de offset fijo, Nicaragua no usa horario de verano).
 *
 * previous/next se calculan con aritmética de calendario EXPLÍCITA (mes-1/
 * mes+1, mitad-1/mitad+1 cruzando de mes cuando hace falta) — NO saltando
 * un número fijo de días y re-resolviendo: un salto fijo de 16 días para
 * "la quincena vecina" se ve bien en meses de 30/31 días pero en febrero
 * (28 días) aterriza en la mitad equivocada del mes anterior. Mismo
 * problema, peor, con "un mes fijo de 32 días" — ningún mes tiene 32 días,
 * así que ese salto SIEMPRE cruza de más. Verificado a mano antes de
 * escribir esto (ver tests: cruce de febrero, cruce de año).
 */
export type PeriodKind = "DAY" | "WEEK" | "QUINCENA" | "MONTH" | "CUSTOM";

export type PeriodRange = { start: Date; end: Date; label: string };

export type ResolvedPeriod = PeriodRange & {
  kind: PeriodKind;
  previous: PeriodRange;
  next: PeriodRange;
};

const MONTH_SHORT = new Intl.DateTimeFormat("es-NI", { month: "short", timeZone: "UTC" });
const MONTH_LONG = new Intl.DateTimeFormat("es-NI", { month: "long", timeZone: "UTC" });

function monthShort(d: Date): string {
  return MONTH_SHORT.format(d);
}
function monthLong(d: Date): string {
  const name = MONTH_LONG.format(d);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** businessDate (medianoche UTC ancla) → {year, month 1-12, day}, leídos directo en UTC (ya está anclado al calendario Managua). */
function ymd(businessDate: Date): { year: number; month: number; day: number } {
  return { year: businessDate.getUTCFullYear(), month: businessDate.getUTCMonth() + 1, day: businessDate.getUTCDate() };
}

function businessDateUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Último día calendario de un mes (28-31). */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function previousMonthOf(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}
function nextMonthOf(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function dayLabel(businessDate: Date): string {
  const { day } = ymd(businessDate);
  return `${day} ${monthShort(businessDate)}`;
}

/** [start,end) de día/semana/quincena/mes → su label, mostrando el mes (y año) solo cuando cambia dentro del rango. */
function rangeLabel(prefix: string, startBd: Date, endBd: Date): string {
  const { year: y1 } = ymd(startBd);
  const { year: y2 } = ymd(endBd);
  const sameMonth = startBd.getUTCFullYear() === endBd.getUTCFullYear() && startBd.getUTCMonth() === endBd.getUTCMonth();
  if (startBd.getTime() === endBd.getTime()) {
    return `${prefix}${dayLabel(startBd)} ${y1}`;
  }
  if (sameMonth) {
    return `${prefix}${ymd(startBd).day}–${ymd(endBd).day} ${monthShort(startBd)} ${y1}`;
  }
  const yearSuffix = y1 === y2 ? ` ${y1}` : ` ${y1}/${y2}`;
  return `${prefix}${dayLabel(startBd)} – ${dayLabel(endBd)}${yearSuffix}`;
}

function dayRangeFor(anchorBd: Date): PeriodRange {
  const { start, end } = operationalWindow(anchorBd);
  return { start, end, label: `${dayLabel(anchorBd)} ${ymd(anchorBd).year}` };
}

function weekRangeFor(someDayInWeekBd: Date): PeriodRange {
  const weekStart = weekStartForBusinessDate(someDayInWeekBd);
  const weekEndInclusive = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
  const { start } = operationalWindow(weekStart);
  const { start: end } = operationalWindow(new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000));
  return { start, end, label: rangeLabel("Semana ", weekStart, weekEndInclusive) };
}

/** 1–15 o 16–fin de mes, fechas CALENDARIO (aunque el pago caiga en 30 o sábado — payday-calendar.ts es otra cosa, el período contable es por fecha). */
function quincenaRangeFor(year: number, month: number, half: 1 | 2): PeriodRange {
  const startDay = half === 1 ? 1 : 16;
  const endDayInclusive = half === 1 ? 15 : lastDayOfMonth(year, month);
  const startBd = businessDateUtc(year, month, startDay);
  const endBdInclusive = businessDateUtc(year, month, endDayInclusive);
  const { start } = operationalWindow(startBd);
  const { start: end } = operationalWindow(new Date(endBdInclusive.getTime() + 24 * 60 * 60 * 1000));
  const label = `${half === 1 ? "1ª" : "2ª"} quincena ${monthShort(startBd)} ${year}`;
  return { start, end, label };
}

function monthRangeFor(year: number, month: number): PeriodRange {
  const startBd = businessDateUtc(year, month, 1);
  const { year: ny, month: nm } = nextMonthOf(year, month);
  const nextMonthBd = businessDateUtc(ny, nm, 1);
  const { start } = operationalWindow(startBd);
  const { start: end } = operationalWindow(nextMonthBd);
  return { start, end, label: `${monthLong(startBd)} ${year}` };
}

function customRange(from: Date, to: Date): PeriodRange {
  const fromBd = businessDateFromInstant(from, OPERATIONAL_TIMEZONE);
  const toBd = businessDateFromInstant(to, OPERATIONAL_TIMEZONE);
  const { start } = operationalWindow(fromBd);
  const { start: end } = operationalWindow(new Date(toBd.getTime() + 24 * 60 * 60 * 1000));
  return { start, end, label: rangeLabel("", fromBd, toBd) };
}

/**
 * Resuelve un período. `anchorDate` es cualquier instante dentro del
 * período deseado (típicamente "ahora", o una fecha elegida con las
 * flechas ← →). Para CUSTOM, `custom.from`/`custom.to` son el rango
 * exacto (inclusive) — anchorDate se ignora.
 */
export function resolvePeriod(
  kind: PeriodKind,
  anchorDate: Date = new Date(),
  custom?: { from: Date; to: Date },
): ResolvedPeriod {
  if (kind === "CUSTOM") {
    if (!custom) throw new Error("VALIDATION_ERROR: CUSTOM requiere from/to.");
    const current = customRange(custom.from, custom.to);
    // Antes/después de un rango a medida: la misma duración, pegada inmediatamente antes/después.
    const durationMs = current.end.getTime() - current.start.getTime();
    const previous = customRange(new Date(current.start.getTime() - durationMs), new Date(current.start.getTime() - 24 * 60 * 60 * 1000));
    const next = customRange(new Date(current.end.getTime()), new Date(current.end.getTime() + durationMs - 24 * 60 * 60 * 1000));
    return { kind, ...current, previous, next };
  }

  const anchorBd = businessDateFromInstant(anchorDate, OPERATIONAL_TIMEZONE);

  if (kind === "DAY") {
    return {
      kind,
      ...dayRangeFor(anchorBd),
      previous: dayRangeFor(new Date(anchorBd.getTime() - 24 * 60 * 60 * 1000)),
      next: dayRangeFor(new Date(anchorBd.getTime() + 24 * 60 * 60 * 1000)),
    };
  }

  if (kind === "WEEK") {
    const weekStart = weekStartForBusinessDate(anchorBd);
    return {
      kind,
      ...weekRangeFor(anchorBd),
      previous: weekRangeFor(new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000)),
      next: weekRangeFor(new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)),
    };
  }

  if (kind === "QUINCENA") {
    const { year, month, day } = ymd(anchorBd);
    const half: 1 | 2 = day <= 15 ? 1 : 2;
    const current = quincenaRangeFor(year, month, half);
    const previous = half === 1
      ? (() => { const p = previousMonthOf(year, month); return quincenaRangeFor(p.year, p.month, 2); })()
      : quincenaRangeFor(year, month, 1);
    const next = half === 2
      ? (() => { const n = nextMonthOf(year, month); return quincenaRangeFor(n.year, n.month, 1); })()
      : quincenaRangeFor(year, month, 2);
    return { kind, ...current, previous, next };
  }

  // MONTH
  const { year, month } = ymd(anchorBd);
  const current = monthRangeFor(year, month);
  const prev = previousMonthOf(year, month);
  const nxt = nextMonthOf(year, month);
  return { kind, ...current, previous: monthRangeFor(prev.year, prev.month), next: monthRangeFor(nxt.year, nxt.month) };
}

export type MonthSegment = { year: number; month: number; start: Date; end: Date; daysInSegment: number; daysInMonth: number };

/**
 * prompt-gastos-semana-quincena.md Fase 2.3 — prorratea un [start,end) en
 * sub-rangos, uno por cada mes calendario (Managua) que toca. Una QUINCENA
 * o un MES nunca cruzan de mes (un solo segmento); una SEMANA sí puede
 * (ej. lunes 28 sep a domingo 4 oct → un segmento de 3 días en septiembre,
 * otro de 4 días en octubre) — el prorrateo de un gasto RECURRING tiene que
 * usar los DÍAS DE CADA MES por separado (septiembre tiene 30, no 31).
 */
export function splitRangeByManaguaMonth(start: Date, end: Date): MonthSegment[] {
  const segments: MonthSegment[] = [];
  let cursor = start;
  while (cursor < end) {
    const cursorBd = businessDateFromInstant(cursor, OPERATIONAL_TIMEZONE);
    const { year, month } = ymd(cursorBd);
    const monthBoundary = monthRangeFor(year, month);
    const segEnd = monthBoundary.end < end ? monthBoundary.end : end;
    const daysInSegment = Math.round((segEnd.getTime() - cursor.getTime()) / (24 * 60 * 60 * 1000));
    const daysInMonth = lastDayOfMonth(year, month);
    segments.push({ year, month, start: cursor, end: segEnd, daysInSegment, daysInMonth });
    cursor = segEnd;
  }
  return segments;
}
