/**
 * ============================================================================
 *  DEFINICIÓN ÚNICA DE "DÍA OPERATIVO"  (ventana temporal)
 * ============================================================================
 *
 * El negocio opera con un "día operativo" que NO coincide con el día de
 * calendario: arranca a las 06:00 (hora local America/Managua) y dura 24h.
 * Toda la lógica de operaciones (resúmenes, reportes, cierres) debe usar esta
 * misma ventana para que las cifras nunca diverjan entre módulos.
 *
 * Antes existían dos definiciones distintas:
 *   - operations/service.ts → ventana operativa 06:00 (correcta)
 *   - dashboard/service.ts  → medianoche local (sólo para widgets "de hoy")
 *
 * Este módulo centraliza la definición operativa. El dashboard mantiene su
 * semántica de "día de calendario" a propósito (widgets de actividad de hoy),
 * pero cualquier cálculo OPERATIVO/contable usa esta ventana.
 */

export const OPERATIONAL_TIMEZONE = "America/Managua";

/** Hora local en la que comienza el día operativo (06:00). */
export const OPERATIONAL_DAY_START_HOUR = 6;

/** Duración del día operativo en milisegundos (24 horas). */
export const OPERATIONAL_DAY_DURATION_MS = 24 * 60 * 60 * 1000;

function localDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = formatter.format(date).split("-").map(Number);
  return { year, month, day };
}

/** Fecha de negocio (medianoche UTC del día calendario local) a partir de "ahora". */
export function businessDateFromNow(now = new Date()) {
  const { year, month, day } = localDateParts(now);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

/** Fecha de negocio a partir de una entrada `YYYY-MM-DD` (o "ahora" si no se da). */
export function businessDateFromInput(input?: string) {
  if (!input) return businessDateFromNow();
  const [year, month, day] = input.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

/**
 * Calcula la ventana [start, end) del día operativo para una `businessDate`.
 * Inicio: 06:00 del día; fin: 06:00 del día siguiente.
 */
export function operationalWindow(businessDate: Date) {
  const year = businessDate.getUTCFullYear();
  const month = businessDate.getUTCMonth();
  const day = businessDate.getUTCDate();
  const start = new Date(Date.UTC(year, month, day, OPERATIONAL_DAY_START_HOUR, 0, 0, 0));
  const end = new Date(start.getTime() + OPERATIONAL_DAY_DURATION_MS);
  return { start, end };
}
