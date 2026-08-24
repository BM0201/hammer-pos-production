export const OPERATIONAL_TIMEZONE = "America/Managua";
const TIMEZONE = OPERATIONAL_TIMEZONE;

/** Hora (0–23) a la que termina el día de negocio. 0 = medianoche (comportamiento por defecto). */
export const DEFAULT_BUSINESS_DAY_ENDS_AT_HOURS = 0;

function localWallClockParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/**
 * Fecha de negocio (a las 00:00 UTC) a la que pertenece un instante, según la
 * zona horaria y la hora de corte del día de negocio.
 *
 * ERP real: si businessDayEndsAt = 3 (03:00), una venta a las 02:30 AM pertenece
 * al día anterior, porque el día de negocio aún no había cerrado. Con
 * businessDayEndsAt = 0 (default) es simplemente la fecha calendario local.
 *
 * Pura y exportada para tests (no usa `new Date()` salvo el instante recibido).
 */
export function businessDateFromInstant(
  instant: Date,
  timezone: string = TIMEZONE,
  businessDayEndsAt: number = DEFAULT_BUSINESS_DAY_ENDS_AT_HOURS,
): Date {
  const { year, month, day, hour } = localWallClockParts(instant, timezone);
  let utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  // Antes de la hora de corte → todavía es el día de negocio anterior.
  if (businessDayEndsAt > 0 && hour < businessDayEndsAt) {
    utcMidnight -= 24 * 60 * 60 * 1000;
  }
  return new Date(utcMidnight);
}

export function businessDateFromNow(now = new Date()) {
  return businessDateFromInstant(now, TIMEZONE, DEFAULT_BUSINESS_DAY_ENDS_AT_HOURS);
}

export function businessDateFromInput(input?: string) {
  if (!input) return businessDateFromNow();
  const [year, month, day] = input.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

export function operationalWindow(businessDate: Date) {
  const year = businessDate.getUTCFullYear();
  const month = businessDate.getUTCMonth();
  const day = businessDate.getUTCDate();
  const start = new Date(Date.UTC(year, month, day, 6, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function getOperationalWindowForNow(now = new Date()) {
  return operationalWindow(businessDateFromNow(now));
}

/**
 * Semana calendario lunes-domingo (Managua) que contiene `businessDate`.
 * `businessDate` ya viene anclado a medianoche UTC representando el día
 * calendario local (businessDateFromInstant), así que getUTCDay() da el día
 * de semana correcto sin volver a tocar zona horaria (prompt-modulo-dinero-
 * semana-sucursal.md §3: "no la hora local del navegador").
 */
export function weekStartForBusinessDate(businessDate: Date): Date {
  const weekday = businessDate.getUTCDay(); // 0=domingo..6=sábado
  const daysSinceMonday = (weekday + 6) % 7; // lunes=0, martes=1, ..., domingo=6
  return new Date(businessDate.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);
}

/** Lunes y domingo (ambos como businessDate, medianoche UTC) de la semana que contiene `businessDate`. */
export function businessDateWeekRange(businessDate: Date): { weekStart: Date; weekEnd: Date } {
  const weekStart = weekStartForBusinessDate(businessDate);
  const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
  return { weekStart, weekEnd };
}

/**
 * El siguiente día hábil (lunes-viernes, sin feriados — mismo criterio que
 * countBusinessDaysBetween en treasury/exposure.ts) después del día de
 * negocio de `now`, como businessDate (medianoche UTC anclada a
 * America/Managua). Nunca +24h fijas: un viernes "mañana" es lunes, y esta
 * función existe justo para que ningún caller tenga que acordarse de eso.
 */
export function nextBusinessDayFrom(now: Date = new Date()): Date {
  let cursor = businessDateFromNow(now);
  do {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6);
  return cursor;
}
