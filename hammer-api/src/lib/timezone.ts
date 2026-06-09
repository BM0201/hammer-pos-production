/**
 * Timezone helpers for Nicaragua (America/Managua).
 *
 * The POS operates entirely in `America/Managua` (UTC-6, no DST). When a user
 * picks a calendar day in the UI (e.g. "2026-06-09"), the corresponding range
 * in UTC must account for the -6h offset, otherwise movements/closures recorded
 * near midnight fall into the wrong day.
 *
 * These helpers convert a `YYYY-MM-DD` local day into the precise UTC `Date`
 * boundaries (start = 00:00:00.000 local, end = 23:59:59.999 local).
 */

export const NICARAGUA_TIMEZONE = "America/Managua";
// Nicaragua is permanently UTC-6 (no daylight saving time).
const NICARAGUA_UTC_OFFSET_HOURS = 6;
const OFFSET_MS = NICARAGUA_UTC_OFFSET_HOURS * 60 * 60 * 1000;

const YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Returns true when the string is a valid `YYYY-MM-DD` calendar date. */
export function isValidYmd(value: string | undefined | null): value is string {
  if (!value || !YMD_REGEX.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Start of a Managua calendar day as a UTC `Date`.
 * "2026-06-09" → 2026-06-09T06:00:00.000Z (00:00 local).
 */
export function managuaStartOfDayUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) + OFFSET_MS);
}

/**
 * End of a Managua calendar day as a UTC `Date`.
 * "2026-06-09" → 2026-06-10T05:59:59.999Z (23:59:59.999 local).
 */
export function managuaEndOfDayUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) + OFFSET_MS);
}

/** Current calendar day in Managua as `YYYY-MM-DD`. */
export function managuaToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NICARAGUA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA already yields YYYY-MM-DD
}
