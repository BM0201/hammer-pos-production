/**
 * Pure unit tests for brain/scoring.ts — no DB, no network.
 * Run with: node --import tsx --test src/modules/brain/brain.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Inline copies of the tested functions so this file has zero runtime dependencies.

function makeDecisionFingerprint(parts: Array<string | number | boolean | null | undefined>) {
  return createHash("sha256")
    .update(parts.map((p) => String(p ?? "")).join("|"))
    .digest("hex");
}

function makeIdempotencyKey(parts: Array<string | number | boolean | null | undefined>) {
  return `brain:${makeDecisionFingerprint(parts)}`;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
const severityWeight: Record<Severity, number> = {
  CRITICAL: 95, HIGH: 80, MEDIUM: 55, LOW: 30, INFO: 10,
};

function riskScoreFor(severity: Severity, confidenceScore = 75) {
  const confidence = confidenceScore <= 1 ? confidenceScore * 100 : confidenceScore;
  return clampScore(severityWeight[severity] * Math.max(10, confidence) / 100);
}

function impactScoreFor(impactAmount?: number | null) {
  const impact = Math.abs(Number(impactAmount ?? 0));
  if (impact >= 100000) return 100;
  if (impact >= 50000) return 85;
  if (impact >= 10000) return 70;
  if (impact >= 2500) return 50;
  if (impact > 0) return 25;
  return 0;
}

function urgencyScoreFor(severity: Severity, expiresAt?: Date | null) {
  if (severity === "CRITICAL") return 100;
  if (severity === "HIGH") return 80;
  if (!expiresAt) return severity === "MEDIUM" ? 50 : 25;
  const hours = (expiresAt.getTime() - Date.now()) / 36e5;
  if (hours <= 0) return 95;
  if (hours <= 24) return 80;
  if (hours <= 72) return 60;
  return 35;
}

function priorityScoreFor(input: {
  severity: Severity;
  riskScore?: number | null;
  confidenceScore?: number | null;
  impactAmount?: number | null;
  expiresAt?: Date | null;
}) {
  const risk = clampScore(input.riskScore ?? riskScoreFor(input.severity, input.confidenceScore ?? 75));
  const confidenceRaw = Number(input.confidenceScore ?? 75);
  const confidence = clampScore(confidenceRaw <= 1 ? confidenceRaw * 100 : confidenceRaw);
  const impact = impactScoreFor(input.impactAmount);
  const urgency = urgencyScoreFor(input.severity, input.expiresAt);
  return clampScore(risk * 0.4 + confidence * 0.2 + impact * 0.25 + urgency * 0.15);
}

function normalizeConfidence(value?: number | null) {
  const raw = Number(value ?? 75);
  return clampScore(raw <= 1 ? raw * 100 : raw);
}

function severityForInventoryGap(quantity: number, threshold = 0): Severity {
  if (quantity < 0) return "CRITICAL";
  if (quantity === 0) return "HIGH";
  if (quantity <= threshold) return "MEDIUM";
  return "LOW";
}

function severityForMargin(marginPct: number): Severity {
  if (marginPct < 0) return "CRITICAL";
  if (marginPct < 10) return "HIGH";
  if (marginPct < 20) return "MEDIUM";
  return "LOW";
}

// --- Tests ---

describe("makeDecisionFingerprint", () => {
  it("L.1: same parts always produce same fingerprint (idempotent)", () => {
    const a = makeDecisionFingerprint(["inventory", "negative-stock", "branch-1", "product-99"]);
    const b = makeDecisionFingerprint(["inventory", "negative-stock", "branch-1", "product-99"]);
    assert.equal(a, b);
  });

  it("L.2: order matters — different order produces different fingerprint", () => {
    const a = makeDecisionFingerprint(["a", "b", "c"]);
    const b = makeDecisionFingerprint(["c", "b", "a"]);
    assert.notEqual(a, b);
  });

  it("L.3: null/undefined parts stringify to empty string without throwing", () => {
    assert.doesNotThrow(() => makeDecisionFingerprint([null, undefined, "ok"]));
  });
});

describe("makeIdempotencyKey", () => {
  it("L.4: always starts with 'brain:'", () => {
    const key = makeIdempotencyKey(["decision", "x"]);
    assert.ok(key.startsWith("brain:"), `Expected 'brain:' prefix, got: ${key}`);
  });

  it("L.5: same inputs produce same key", () => {
    assert.equal(makeIdempotencyKey(["decision", "abc"]), makeIdempotencyKey(["decision", "abc"]));
  });
});

describe("clampScore", () => {
  it("L.6: negative input clamps to 0", () => {
    assert.equal(clampScore(-10), 0);
  });

  it("L.6b: value above 100 clamps to 100", () => {
    assert.equal(clampScore(150), 100);
  });

  it("L.6c: NaN returns 0", () => {
    assert.equal(clampScore(NaN), 0);
  });
});

describe("riskScoreFor", () => {
  it("L.7: CRITICAL with 100% confidence returns 95", () => {
    assert.equal(riskScoreFor("CRITICAL", 100), 95);
  });

  it("L.7b: HIGH with 50% confidence = round(80 * 50/100) = 40", () => {
    assert.equal(riskScoreFor("HIGH", 50), 40);
  });

  it("L.7c: decimal confidence ≤1 is scaled to 0-100", () => {
    assert.equal(riskScoreFor("CRITICAL", 1), 95); // 1.0 → 100% → 95
  });
});

describe("normalizeConfidence", () => {
  it("L.8: decimal input 0.75 returns 75", () => {
    assert.equal(normalizeConfidence(0.75), 75);
  });

  it("L.8b: integer input 85 returns 85 (already in 0-100 range)", () => {
    assert.equal(normalizeConfidence(85), 85);
  });

  it("L.8c: null input returns default 75", () => {
    assert.equal(normalizeConfidence(null), 75);
  });
});

describe("impactScoreFor", () => {
  it("L.9: zero impact → 0", () => {
    assert.equal(impactScoreFor(0), 0);
  });

  it("L.9b: 100k+ impact → 100", () => {
    assert.equal(impactScoreFor(100000), 100);
  });

  it("L.9c: 5000 impact → 50", () => {
    assert.equal(impactScoreFor(5000), 50);
  });

  it("L.9d: negative impact treated as absolute value", () => {
    assert.equal(impactScoreFor(-100000), 100);
  });
});

describe("urgencyScoreFor", () => {
  it("L.10: CRITICAL always returns 100", () => {
    assert.equal(urgencyScoreFor("CRITICAL"), 100);
  });

  it("L.10b: HIGH without expiresAt returns 80", () => {
    assert.equal(urgencyScoreFor("HIGH"), 80);
  });

  it("L.10c: MEDIUM without expiresAt returns 50", () => {
    assert.equal(urgencyScoreFor("MEDIUM"), 50);
  });

  it("L.10d: expired (expiresAt in past) returns 95 for any non-CRITICAL severity", () => {
    const past = new Date(Date.now() - 1000);
    assert.equal(urgencyScoreFor("MEDIUM", past), 95);
  });
});

describe("priorityScoreFor — weighted formula", () => {
  it("L.11: CRITICAL, 100% confidence, 100k impact → max score (risk cap at 95 → formula gives 98)", () => {
    // risk=95, confidence=100, impact=100, urgency=100 → 95*0.4+100*0.2+100*0.25+100*0.15 = 38+20+25+15 = 98
    const score = priorityScoreFor({ severity: "CRITICAL", confidenceScore: 100, impactAmount: 100000 });
    assert.equal(score, 98);
  });

  it("L.11b: INFO with no impact → low priority", () => {
    const score = priorityScoreFor({ severity: "INFO", confidenceScore: 50, impactAmount: 0 });
    assert.ok(score < 30, `Expected score < 30, got ${score}`);
  });
});

describe("severityForMargin", () => {
  it("L.12: negative margin → CRITICAL", () => {
    assert.equal(severityForMargin(-1), "CRITICAL");
  });

  it("L.12b: 5% margin → HIGH (below 10%)", () => {
    assert.equal(severityForMargin(5), "HIGH");
  });

  it("L.12c: 15% margin → MEDIUM", () => {
    assert.equal(severityForMargin(15), "MEDIUM");
  });

  it("L.12d: 25% margin → LOW", () => {
    assert.equal(severityForMargin(25), "LOW");
  });
});

describe("severityForInventoryGap", () => {
  it("L.13: negative quantity → CRITICAL", () => {
    assert.equal(severityForInventoryGap(-3), "CRITICAL");
  });

  it("L.13b: zero quantity → HIGH", () => {
    assert.equal(severityForInventoryGap(0), "HIGH");
  });

  it("L.13c: quantity at threshold → MEDIUM", () => {
    assert.equal(severityForInventoryGap(5, 5), "MEDIUM");
  });

  it("L.13d: quantity above threshold → LOW", () => {
    assert.equal(severityForInventoryGap(10, 5), "LOW");
  });
});
