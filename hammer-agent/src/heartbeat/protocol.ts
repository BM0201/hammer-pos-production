import type { CameraHealthState } from "../analysis/classifier.ts";

/**
 * Contrato versionado del heartbeat (adenda §2.3): "el servidor tolera
 * versiones viejas... esto tiene que existir desde el primer commit". El
 * agente manda su protocolVersion; el servidor decide cómo interpretarlo.
 * Subir este número solo cuando el payload cambia de forma incompatible.
 */
export const AGENT_PROTOCOL_VERSION = 1;

export type AgentHeartbeatPayload = {
  protocolVersion: number;
  agentVersion: string;
  branchId: string;
  timestamp: string; // ISO 8601, UTC
  nvrReachable: boolean;
  /** Nunca incluye cuadros ni binarios — solo el resultado ya clasificado en la sucursal. */
  cameras: Array<{ cameraId: string; state: CameraHealthState }>;
};

export type AgentHeartbeatResponse = {
  protocolVersion: number;
  acknowledgedAt: string;
  /** Versión que el servidor quiere que este agente corra — despliegue escalonado por sucursal (adenda §2.1). */
  targetAgentVersion: string;
};

/**
 * Los cuatro estados de sucursal (adenda §3) — nunca tres. El heartbeat es
 * independiente del sondeo de cámaras: la salud del agente NUNCA se deriva
 * de sus reportes de cámara, son dos señales distintas.
 */
export type BranchSituation = "AGENT_UNREACHABLE" | "NVR_UNREACHABLE" | "CAMERAS_REPORTING";

export function deriveBranchSituation(input: { agentHeartbeatReceived: boolean; nvrReachable: boolean }): BranchSituation {
  if (!input.agentHeartbeatReceived) return "AGENT_UNREACHABLE";
  if (!input.nvrReachable) return "NVR_UNREACHABLE";
  return "CAMERAS_REPORTING";
}

export type CameraReportSource = "AGENT_REPORT" | "AGENT_UNREACHABLE" | "NVR_UNREACHABLE";
export type CameraStatus = CameraHealthState | "UNKNOWN";

export type ResolvedCameraStatus = { cameraId: string; status: CameraStatus; source: CameraReportSource };

/**
 * Regla central de la adenda §3: fuera de CAMERAS_REPORTING, toda cámara
 * pasa a UNKNOWN (nunca a OFFLINE) — evita el falso positivo masivo de "el
 * NVR se cayó" reportado como "doce cámaras fallando".
 */
export function resolveCameraStatuses(
  situation: BranchSituation,
  perCameraClassification: Array<{ cameraId: string; state: CameraHealthState }>,
): ResolvedCameraStatus[] {
  if (situation === "AGENT_UNREACHABLE") {
    return perCameraClassification.map((c) => ({ cameraId: c.cameraId, status: "UNKNOWN", source: "AGENT_UNREACHABLE" }));
  }
  if (situation === "NVR_UNREACHABLE") {
    return perCameraClassification.map((c) => ({ cameraId: c.cameraId, status: "UNKNOWN", source: "NVR_UNREACHABLE" }));
  }
  return perCameraClassification.map((c) => ({ cameraId: c.cameraId, status: c.state, source: "AGENT_REPORT" }));
}

export type NotificationEvent =
  | { kind: "BRANCH_INFRA"; branchId: string; reason: "AGENT_UNREACHABLE" | "NVR_UNREACHABLE" | "SEGMENT_DOWN"; affectedCameraIds: string[] }
  | { kind: "CAMERA"; cameraId: string; state: CameraHealthState };

/**
 * Cuando todas las cámaras de una sucursal, o de un grupo que comparte
 * segmento de red, caen en el mismo ciclo, se colapsa en UNA alerta de
 * infraestructura en vez de una por cámara (adenda §3, "Correlación").
 * El historial individual de cada cámara se sigue registrando aparte —
 * acá solo se decide cuántos AVISOS salen, no qué se guarda.
 *
 * `segmentOf` es opcional: sin información de segmento, solo se agrupa
 * cuando caen TODAS las cámaras de la sucursal a la vez.
 */
export function groupFailuresForNotification(
  statuses: ResolvedCameraStatus[],
  segmentOf?: (cameraId: string) => string | null,
): NotificationEvent[] {
  const failing = statuses.filter((s) => s.status !== "OK" && s.status !== "UNKNOWN");
  if (failing.length === 0) return [];
  if (failing.length === 1) {
    const s = failing[0];
    return [{ kind: "CAMERA", cameraId: s.cameraId, state: s.status as CameraHealthState }];
  }

  const groups = new Map<string, ResolvedCameraStatus[]>();
  for (const s of failing) {
    const key = segmentOf?.(s.cameraId) ?? "__branch__";
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  const events: NotificationEvent[] = [];
  for (const [key, members] of groups) {
    // Se colapsa solo si TODO el grupo (segmento, o toda la sucursal si no
    // hay info de segmento) cayó junto — 2 de 12 cámaras caídas siguen
    // siendo 2 avisos individuales, no una alerta de infraestructura.
    const totalInGroup = key === "__branch__" ? statuses.length : statuses.filter((s) => segmentOf?.(s.cameraId) === key).length;
    if (members.length > 1 && members.length === totalInGroup) {
      events.push({
        kind: "BRANCH_INFRA",
        branchId: "", // el caller lo completa — este módulo no conoce branchId de cada status
        reason: "SEGMENT_DOWN",
        affectedCameraIds: members.map((m) => m.cameraId),
      });
    } else {
      for (const m of members) events.push({ kind: "CAMERA", cameraId: m.cameraId, state: m.status as CameraHealthState });
    }
  }
  return events;
}
