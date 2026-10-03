/**
 * Períodos del hub de Producción, anclados a America/Managua (UTC-6, sin
 * horario de verano) — el mismo corte de mes que usa el backend
 * (firstOfMonthUtc en hammer-api/src/app/api/master/production/dashboard/route.ts).
 */

export type PeriodPreset = "THIS_MONTH" | "LAST_MONTH" | "LAST_90_DAYS";

export const PERIOD_PRESETS: Array<{ value: PeriodPreset; label: string }> = [
  { value: "THIS_MONTH", label: "Este mes" },
  { value: "LAST_MONTH", label: "Mes anterior" },
  { value: "LAST_90_DAYS", label: "Últimos 90 días" },
];

const MANAGUA_OFFSET_HOURS = 6;
const DAY_MS = 86_400_000;

/** 00:00 hora de Managua del primer día del mes (año, mes 0-11), en UTC. */
function managuaMonthStart(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex, 1, MANAGUA_OFFSET_HOURS, 0, 0, 0));
}

function managuaYearMonth(now: Date): { year: number; monthIndex: number } {
  const local = new Date(now.getTime() - MANAGUA_OFFSET_HOURS * 3_600_000);
  return { year: local.getUTCFullYear(), monthIndex: local.getUTCMonth() };
}

export function resolvePeriod(preset: PeriodPreset, now: Date = new Date()): { from: Date; to: Date } {
  const { year, monthIndex } = managuaYearMonth(now);
  if (preset === "LAST_MONTH") {
    const from = managuaMonthStart(year, monthIndex - 1);
    const to = new Date(managuaMonthStart(year, monthIndex).getTime() - 1);
    return { from, to };
  }
  if (preset === "LAST_90_DAYS") {
    return { from: new Date(now.getTime() - 90 * DAY_MS), to: now };
  }
  return { from: managuaMonthStart(year, monthIndex), to: now };
}

/** "1 oct – 2 oct 2026", leído en hora de Managua. */
export function formatPeriodRange(from: Date, to: Date): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "America/Managua" };
  const year = new Intl.DateTimeFormat("es-NI", { year: "numeric", timeZone: "America/Managua" }).format(to);
  const start = new Intl.DateTimeFormat("es-NI", opts).format(from);
  const end = new Intl.DateTimeFormat("es-NI", opts).format(to);
  return `${start} – ${end} ${year}`;
}
