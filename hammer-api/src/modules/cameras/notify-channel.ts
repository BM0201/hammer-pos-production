/**
 * Canal externo (prompt §4.3): "el módulo emite un evento tipado; el canal
 * es configuración, no código". Webhook saliente configurable por
 * CAMERA_NOTIFY_WEBHOOK_URL — sin configurar, el módulo sigue funcionando
 * igual (decisión de Brain + contador de sidebar sí ocurren siempre), solo
 * no hay aviso fuera de la app. Nunca debe tumbar el heartbeat: siempre
 * best-effort, con timeout corto.
 */

export type CameraExternalEvent =
  | { type: "CAMERA_DOWN"; branchId: string; cameraId: string; cameraName: string; state: string; at: string }
  | { type: "CAMERA_RECOVERED"; branchId: string; cameraId: string; cameraName: string; at: string }
  | { type: "BRANCH_INFRA_DOWN"; branchId: string; reason: string; affectedCameraCount: number; at: string }
  | { type: "BRANCH_AGENT_UNREACHABLE"; branchId: string; at: string };

const WEBHOOK_TIMEOUT_MS = 5000;

export async function dispatchExternalNotification(event: CameraExternalEvent): Promise<void> {
  const url = process.env.CAMERA_NOTIFY_WEBHOOK_URL;
  if (!url) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } catch {
    // Best-effort: un webhook caído nunca debe tumbar el procesamiento del heartbeat.
  } finally {
    clearTimeout(timeout);
  }
}
