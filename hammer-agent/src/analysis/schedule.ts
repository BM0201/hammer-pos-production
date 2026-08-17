/**
 * BLACK se calibra contra el horario de la sucursal, no contra el reloj
 * (prompt §3): una cámara sin infrarrojo en negro a las 2 AM está bien.
 * Mismo criterio que el día operativo: todo en UTC internamente, esta
 * función recibe ya la hora LOCAL decimal de la sucursal (America/Managua)
 * resuelta por el caller — acá no hay zonas horarias, solo aritmética.
 */

export type BranchLitHours = {
  /** Hora local decimal (0-24) en la que se espera que haya luz — ej. 6 = 6:00am. */
  startHour: number;
  /** Hora local decimal (0-24) hasta la que se espera luz — ej. 20 = 8:00pm. */
  endHour: number;
};

/** Soporta ventanas que cruzan medianoche (startHour > endHour). */
export function isWithinExpectedLitHours(localHour: number, hours: BranchLitHours): boolean {
  const h = ((localHour % 24) + 24) % 24;
  if (hours.startHour <= hours.endHour) {
    return h >= hours.startHour && h < hours.endHour;
  }
  return h >= hours.startHour || h < hours.endHour;
}
