#!/usr/bin/env node
import fs from "node:fs";

const currentPath = process.env.CURRENT_METRICS_PATH ?? "artifacts/metrics/e2e-latency.json";
const previousPath = process.env.PREVIOUS_METRICS_PATH ?? "artifacts/metrics/e2e-latency-previous.json";
const thresholdsPath = process.env.LATENCY_THRESHOLDS_PATH ?? "config/metrics/e2e-latency-thresholds.json";
const outputPath = process.env.METRICS_COMPARISON_PATH ?? "artifacts/metrics/e2e-latency-comparison.json";

if (!fs.existsSync(currentPath)) {
  console.error(`Current metrics not found: ${currentPath}`);
  process.exit(1);
}

const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
const thresholds = fs.existsSync(thresholdsPath)
  ? JSON.parse(fs.readFileSync(thresholdsPath, "utf8"))
  : { regressionTolerancePct: 20, absoluteMaxMs: { p50: 8000, p95: 20000, p99: 30000 } };

const keys = ["p50", "p95", "p99"];
const comparison = {};
let regressions = 0;

const previous = fs.existsSync(previousPath) ? JSON.parse(fs.readFileSync(previousPath, "utf8")) : null;

for (const key of keys) {
  const currentValue = current.durationMs?.[key] ?? 0;
  const previousValue = previous?.durationMs?.[key] ?? null;
  const absoluteMax = thresholds.absoluteMaxMs?.[key] ?? Number.POSITIVE_INFINITY;
  const pctDelta = previousValue && previousValue > 0 ? ((currentValue - previousValue) / previousValue) * 100 : null;
  const isRegressionByPct = pctDelta !== null && pctDelta > thresholds.regressionTolerancePct;
  const isRegressionByAbsolute = currentValue > absoluteMax;
  const regressed = isRegressionByPct || isRegressionByAbsolute;

  if (regressed) {
    regressions += 1;
  }

  comparison[key] = {
    currentMs: currentValue,
    previousMs: previousValue,
    pctDelta,
    absoluteMaxMs: absoluteMax,
    regressed,
    reasons: [
      ...(isRegressionByPct ? [`pct_delta>${thresholds.regressionTolerancePct}`] : []),
      ...(isRegressionByAbsolute ? [`current>${absoluteMax}`] : []),
    ],
  };
}

const result = {
  generatedAt: new Date().toISOString(),
  currentPath,
  previousPath: previous ? previousPath : null,
  thresholdsPath,
  regressions,
  passed: regressions === 0,
  comparison,
};

fs.mkdirSync("artifacts/metrics", { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

if (regressions > 0) {
  process.exit(1);
}
