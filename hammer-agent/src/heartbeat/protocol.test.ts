import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveBranchSituation, resolveCameraStatuses, groupFailuresForNotification, type ResolvedCameraStatus } from "./protocol.ts";

describe("deriveBranchSituation: los cuatro estados nunca se confunden", () => {
  it("sin heartbeat del agente -> AGENT_UNREACHABLE, sin importar el NVR", () => {
    assert.equal(deriveBranchSituation({ agentHeartbeatReceived: false, nvrReachable: true }), "AGENT_UNREACHABLE");
    assert.equal(deriveBranchSituation({ agentHeartbeatReceived: false, nvrReachable: false }), "AGENT_UNREACHABLE");
  });

  it("agente vivo, NVR inalcanzable -> NVR_UNREACHABLE", () => {
    assert.equal(deriveBranchSituation({ agentHeartbeatReceived: true, nvrReachable: false }), "NVR_UNREACHABLE");
  });

  it("agente vivo, NVR OK -> CAMERAS_REPORTING (procede a evaluar cada cámara)", () => {
    assert.equal(deriveBranchSituation({ agentHeartbeatReceived: true, nvrReachable: true }), "CAMERAS_REPORTING");
  });
});

describe("resolveCameraStatuses: la regla UNKNOWN, nunca OFFLINE por ausencia de datos", () => {
  const twelveCameras = Array.from({ length: 12 }, (_, i) => ({ cameraId: `cam-${i}`, state: "OK" as const }));

  it("agente caído -> las 12 cámaras quedan UNKNOWN/AGENT_UNREACHABLE, ninguna OFFLINE", () => {
    const resolved = resolveCameraStatuses("AGENT_UNREACHABLE", twelveCameras);
    assert.equal(resolved.length, 12);
    assert.ok(resolved.every((r) => r.status === "UNKNOWN"));
    assert.ok(resolved.every((r) => r.source === "AGENT_UNREACHABLE"));
    assert.ok(resolved.every((r) => r.status !== "OFFLINE"), "nunca debe reportarse OFFLINE por falta de datos");
  });

  it("NVR caído (agente vivo) -> UNKNOWN/NVR_UNREACHABLE, mismo efecto que agente caído para el usuario", () => {
    const resolved = resolveCameraStatuses("NVR_UNREACHABLE", twelveCameras);
    assert.ok(resolved.every((r) => r.status === "UNKNOWN" && r.source === "NVR_UNREACHABLE"));
  });

  it("todo sano -> pasa el estado real clasificado, con source AGENT_REPORT", () => {
    const mixed = [{ cameraId: "a", state: "OK" as const }, { cameraId: "b", state: "FROZEN" as const }];
    const resolved = resolveCameraStatuses("CAMERAS_REPORTING", mixed);
    assert.deepEqual(resolved, [
      { cameraId: "a", status: "OK", source: "AGENT_REPORT" },
      { cameraId: "b", status: "FROZEN", source: "AGENT_REPORT" },
    ]);
  });
});

describe("groupFailuresForNotification: colapsar solo cuando cae TODO el grupo", () => {
  function statuses(n: number, failingIds: string[]): ResolvedCameraStatus[] {
    return Array.from({ length: n }, (_, i) => {
      const cameraId = `cam-${i}`;
      return { cameraId, status: failingIds.includes(cameraId) ? "OFFLINE" : "OK", source: "AGENT_REPORT" } as ResolvedCameraStatus;
    });
  }

  it("sin fallas -> sin eventos", () => {
    assert.deepEqual(groupFailuresForNotification(statuses(5, [])), []);
  });

  it("una sola cámara caída -> un evento CAMERA, no infraestructura", () => {
    const events = groupFailuresForNotification(statuses(5, ["cam-0"]));
    assert.deepEqual(events, [{ kind: "CAMERA", cameraId: "cam-0", state: "OFFLINE" }]);
  });

  it("2 de 12 caídas -> dos eventos CAMERA, NO se colapsa (caso 6 del prompt original: distinguible de 'todas caídas')", () => {
    const events = groupFailuresForNotification(statuses(12, ["cam-0", "cam-5"]));
    assert.equal(events.length, 2);
    assert.ok(events.every((e) => e.kind === "CAMERA"));
  });

  it("las 12 caen juntas en el mismo ciclo, sin info de segmento -> UNA alerta de infraestructura", () => {
    const all12 = statuses(12, Array.from({ length: 12 }, (_, i) => `cam-${i}`));
    const events = groupFailuresForNotification(all12);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "BRANCH_INFRA");
    if (events[0].kind === "BRANCH_INFRA") {
      assert.equal(events[0].affectedCameraIds.length, 12);
    }
  });

  it("un segmento de red completo cae (3 de 5), el resto sano -> una alerta de infraestructura para ese segmento, sin tocar las otras", () => {
    const all = statuses(5, ["cam-0", "cam-1", "cam-2"]);
    const segmentOf = (id: string) => (["cam-0", "cam-1", "cam-2"].includes(id) ? "switch-patio" : "switch-caja");
    const events = groupFailuresForNotification(all, segmentOf);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "BRANCH_INFRA");
    if (events[0].kind === "BRANCH_INFRA") {
      assert.deepEqual(events[0].affectedCameraIds.sort(), ["cam-0", "cam-1", "cam-2"]);
    }
  });

  it("un segmento cae parcialmente (2 de 3) -> no colapsa, son fallas individuales de cámara", () => {
    const all = statuses(5, ["cam-0", "cam-1"]);
    const segmentOf = (id: string) => (["cam-0", "cam-1", "cam-2"].includes(id) ? "switch-patio" : "switch-caja");
    const events = groupFailuresForNotification(all, segmentOf);
    assert.equal(events.length, 2);
    assert.ok(events.every((e) => e.kind === "CAMERA"));
  });
});
