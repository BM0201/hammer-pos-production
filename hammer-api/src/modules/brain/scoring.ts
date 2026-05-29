import { createHash } from "node:crypto";
import type { BrainDecisionSeverity } from "@prisma/client";

const severityWeight: Record<BrainDecisionSeverity, number> = {
  CRITICAL: 95,
  HIGH: 80,
  MEDIUM: 55,
  LOW: 30,
  INFO: 10,
};

export function makeDecisionFingerprint(parts: Array<string | number | boolean | null | undefined>) {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex");
}

export function makeIdempotencyKey(parts: Array<string | number | boolean | null | undefined>) {
  return `brain:${makeDecisionFingerprint(parts)}`;
}

export function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function riskScoreFor(severity: BrainDecisionSeverity, confidenceScore = 75) {
  const confidence = confidenceScore <= 1 ? confidenceScore * 100 : confidenceScore;
  return clampScore(severityWeight[severity] * Math.max(10, confidence) / 100);
}

export function impactScoreFor(impactAmount?: number | null) {
  const impact = Math.abs(Number(impactAmount ?? 0));
  if (impact >= 100000) return 100;
  if (impact >= 50000) return 85;
  if (impact >= 10000) return 70;
  if (impact >= 2500) return 50;
  if (impact > 0) return 25;
  return 0;
}

export function urgencyScoreFor(severity: BrainDecisionSeverity, expiresAt?: Date | null) {
  if (severity === "CRITICAL") return 100;
  if (severity === "HIGH") return 80;
  if (!expiresAt) return severity === "MEDIUM" ? 50 : 25;
  const hours = (expiresAt.getTime() - Date.now()) / 36e5;
  if (hours <= 0) return 95;
  if (hours <= 24) return 80;
  if (hours <= 72) return 60;
  return 35;
}

export function priorityScoreFor(input: {
  severity: BrainDecisionSeverity;
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

export function normalizeConfidence(value?: number | null) {
  const raw = Number(value ?? 75);
  return clampScore(raw <= 1 ? raw * 100 : raw);
}

export function severityForInventoryGap(quantity: number, threshold = 0): BrainDecisionSeverity {
  if (quantity < 0) return "CRITICAL";
  if (quantity === 0) return "HIGH";
  if (quantity <= threshold) return "MEDIUM";
  return "LOW";
}

export function severityForMargin(marginPct: number): BrainDecisionSeverity {
  if (marginPct < 0) return "CRITICAL";
  if (marginPct < 10) return "HIGH";
  if (marginPct < 20) return "MEDIUM";
  return "LOW";
}
