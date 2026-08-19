/**
 * Espejo puro de hammer-agent/src/heartbeat/protocol.ts — no hay paquete
 * compartido entre hammer-api y hammer-agent (misma convención que el resto
 * del repo entre hammer-api/hammer-frontend), así que la lógica de decisión
 * de los 4 estados de sucursal vive acá también, con la misma firma. Si
 * cambia allá, actualizar acá.
 */
import type { CameraHealthState } from "@prisma/client";

export type BranchSituation = "AGENT_UNREACHABLE" | "NVR_UNREACHABLE" | "CAMERAS_REPORTING";

export function deriveBranchSituation(input: { agentHeartbeatReceived: boolean; nvrReachable: boolean }): BranchSituation {
  if (!input.agentHeartbeatReceived) return "AGENT_UNREACHABLE";
  if (!input.nvrReachable) return "NVR_UNREACHABLE";
  return "CAMERAS_REPORTING";
}

export type CameraReportSource = "AGENT_REPORT" | "AGENT_UNREACHABLE" | "NVR_UNREACHABLE";

export type ResolvedCameraStatus = { cameraId: string; status: CameraHealthState; source: CameraReportSource };

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
  | { kind: "BRANCH_INFRA"; reason: "SEGMENT_DOWN"; affectedCameraIds: string[] }
  | { kind: "CAMERA"; cameraId: string; state: CameraHealthState };

export function groupFailuresForNotification(
  statuses: ResolvedCameraStatus[],
  segmentOf?: (cameraId: string) => string | null,
): NotificationEvent[] {
  const failing = statuses.filter((s) => s.status !== "OK" && s.status !== "UNKNOWN");
  if (failing.length === 0) return [];
  if (failing.length === 1) {
    const s = failing[0];
    return [{ kind: "CAMERA", cameraId: s.cameraId, state: s.status }];
  }

  const groups = new Map<string, ResolvedCameraStatus[]>();
  for (const s of failing) {
    const key = segmentOf?.(s.cameraId) ?? "__branch__";
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }

  const events: NotificationEvent[] = [];
  for (const [key, members] of groups) {
    const totalInGroup = key === "__branch__" ? statuses.length : statuses.filter((s) => segmentOf?.(s.cameraId) === key).length;
    if (members.length > 1 && members.length === totalInGroup) {
      events.push({ kind: "BRANCH_INFRA", reason: "SEGMENT_DOWN", affectedCameraIds: members.map((m) => m.cameraId) });
    } else {
      for (const m of members) events.push({ kind: "CAMERA", cameraId: m.cameraId, state: m.status });
    }
  }
  return events;
}
