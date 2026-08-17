/**
 * Ventana de estabilización de notificación (prompt §4, antirruido): "el
 * estado debe sostenerse N minutos antes de notificar". Como el historial
 * escribe UNA fila por cambio de estado (no por chequeo), el sostenimiento
 * se mide por tiempo de reloj transcurrido desde `changedAt`, no por
 * contar ciclos — funciona igual sin importar cada cuánto heartbeatea el
 * agente. `notifiedAt` marca que este episodio ya avisó, para no repetir
 * el aviso en cada heartbeat siguiente mientras la falla continúa.
 */

export const NOTIFICATION_STABILIZATION_WINDOW_MS = 3 * 60 * 1000;

export function shouldFireNotification(input: { changedAt: Date; notifiedAt: Date | null; now: Date; windowMs?: number }): boolean {
  if (input.notifiedAt !== null) return false;
  const elapsed = input.now.getTime() - input.changedAt.getTime();
  return elapsed >= (input.windowMs ?? NOTIFICATION_STABILIZATION_WINDOW_MS);
}

/** true cuando el episodio se cerró antes de sostenerse -- no corresponde aviso de recuperación si nunca se avisó de la caída. */
export function wasNotifiedThisEpisode(notifiedAt: Date | null): boolean {
  return notifiedAt !== null;
}
