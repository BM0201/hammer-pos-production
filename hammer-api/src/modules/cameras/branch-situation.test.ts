import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveBranchSituation, resolveCameraStatuses, groupFailuresForNotification, type ResolvedCameraStatus } from "./branch-situation";

describe("deriveBranchSituation: los cuatro estados nunca se confunden", () => {
  it("sin heartbeat -> AGENT_UNREACHABLE sin importar el NVR", () => {
    assert.equal(deriveBranchSituation({ agentHeartbeatReceived: false, nvrReachable: true }), "AGENT_UNREACHABLE");
    assert.equal(deriveBranchSituation({ agentHeartbeatReceived: false, nvrReachable: false }), "AGENT_UNREACHABLE");
  });
  it("agente vivo, NVR caído -> NVR_UNREACHABLE", () => {
    assert.equal(deriveBranchSituation({ agentHeartbeatReceived: true, nvrReachable: false }), "NVR_UNREACHABLE");
  });
  it("agente vivo, NVR OK -> CAMERAS_REPORTING", () => {
    assert.equal(deriveBranchSituation({ agentHeartbeatReceived: true, nvrReachable: true }), "CAMERAS_REPORTING");
  });
});

describe("resolveCameraStatuses: UNKNOWN, nunca OFFLINE por ausencia de datos", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ cameraId: `cam-${i}`, state: "OK" as const }));

  it("agente caído -> UNKNOWN/AGENT_UNREACHABLE en las 12, ninguna OFFLINE", () => {
    const resolved = resolveCameraStatuses("AGENT_UNREACHABLE", twelve);
    assert.ok(resolved.every((r) => r.status === "UNKNOWN" && r.source === "AGENT_UNREACHABLE"));
  });
  it("NVR caído -> UNKNOWN/NVR_UNREACHABLE", () => {
    const resolved = resolveCameraStatuses("NVR_UNREACHABLE", twelve);
    assert.ok(resolved.every((r) => r.status === "UNKNOWN" && r.source === "NVR_UNREACHABLE"));
  });
  it("todo sano -> estado real, source AGENT_REPORT", () => {
    const resolved = resolveCameraStatuses("CAMERAS_REPORTING", [{ cameraId: "a", state: "FROZEN" as const }]);
    assert.deepEqual(resolved, [{ cameraId: "a", status: "FROZEN", source: "AGENT_REPORT" }]);
  });
});

describe("groupFailuresForNotification: colapsar solo cuando cae TODO el grupo", () => {
  function statuses(n: number, failingIds: string[]): ResolvedCameraStatus[] {
    return Array.from({ length: n }, (_, i) => {
      const cameraId = `cam-${i}`;
      return { cameraId, status: failingIds.includes(cameraId) ? "OFFLINE" : "OK", source: "AGENT_REPORT" } as ResolvedCameraStatus;
    });
  }

  it("2 de 12 -> dos eventos individuales, no colapsa", () => {
    const events = groupFailuresForNotification(statuses(12, ["cam-0", "cam-5"]));
    assert.equal(events.length, 2);
  });

  it("12 de 12 -> una sola alerta de infraestructura", () => {
    const all = statuses(12, Array.from({ length: 12 }, (_, i) => `cam-${i}`));
    const events = groupFailuresForNotification(all);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "BRANCH_INFRA");
  });
});
