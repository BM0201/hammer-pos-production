import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { severityForCameraLocation } from "./severity";

describe("severityForCameraLocation: por ubicación, no por tipo de falla", () => {
  it("caja -> CRITICAL", () => assert.equal(severityForCameraLocation("CAJA"), "CRITICAL"));
  it("despacho -> HIGH", () => assert.equal(severityForCameraLocation("DESPACHO"), "HIGH"));
  it("patio -> MEDIUM", () => assert.equal(severityForCameraLocation("PATIO"), "MEDIUM"));
  it("pasillo -> LOW", () => assert.equal(severityForCameraLocation("PASILLO"), "LOW"));
  it("otro -> LOW", () => assert.equal(severityForCameraLocation("OTRO"), "LOW"));
  it("caja pesa más que pasillo, siempre", () => {
    const order: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
    assert.ok(order[severityForCameraLocation("CAJA")] > order[severityForCameraLocation("PASILLO")]);
  });
});
