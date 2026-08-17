/**
 * Primitiva de sostenimiento: un valor solo se confirma tras verse repetido
 * N veces seguidas. Se usa en dos lugares que son, en el fondo, el mismo
 * problema — "no reacciones a un solo cuadro/ciclo suelto":
 *
 *  - detección: FROZEN/MOVED necesitan sostenerse varios ciclos antes de
 *    confirmarse (un cuadro perdido no es un freeze; alguien cruzando
 *    delante de la cámara un instante no es que la movieron).
 *  - notificación (prompt §4, antirruido): un estado debe sostenerse N
 *    minutos antes de avisar, para no generar cuarenta avisos por una
 *    cámara que oscila OK/OFFLINE.
 *
 * Una sola primitiva, reutilizada para ambos — no dos mecanismos separados
 * que puedan divergir en comportamiento.
 */

export type SustainState<T> = {
  confirmed: T;
  pending: T | null;
  pendingCount: number;
};

export function createSustain<T>(initial: T): SustainState<T> {
  return { confirmed: initial, pending: null, pendingCount: 0 };
}

/**
 * Alimenta una nueva observación. Devuelve el estado ACTUALIZADO — el valor
 * `confirmed` solo cambia cuando `observed` se repitió `requiredCycles`
 * veces seguidas. Cualquier observación distinta a la que se venía
 * acumulando reinicia el conteo (no es un promedio, es "seguido").
 */
export function feed<T>(state: SustainState<T>, observed: T, requiredCycles: number, equals: (a: T, b: T) => boolean = (a, b) => a === b): SustainState<T> {
  if (equals(observed, state.confirmed)) {
    return { confirmed: state.confirmed, pending: null, pendingCount: 0 };
  }
  const isSamePending = state.pending !== null && equals(observed, state.pending);
  const pendingCount = isSamePending ? state.pendingCount + 1 : 1;
  if (pendingCount >= requiredCycles) {
    return { confirmed: observed, pending: null, pendingCount: 0 };
  }
  return { confirmed: state.confirmed, pending: observed, pendingCount };
}
