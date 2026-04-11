#!/usr/bin/env node
import fs from "node:fs";

function readJson(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing required artifact: ${path}`);
  }
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

const metrics = readJson("artifacts/metrics/e2e-latency-comparison.json");
const infra = readJson("artifacts/smoke/infra-smoke.json");
const functional = readJson("artifacts/smoke/functional-smoke.json");
const releaseCheck = readJson("artifacts/release/release-check-result.json");

const criticalStageFailures = (releaseCheck.stages ?? []).filter((stage) => stage.status !== "passed");
const releaseStagesHealthy = criticalStageFailures.length === 0;

const readyForStaging = releaseStagesHealthy && metrics.passed && infra.passed && functional.passed;
const readyForPilot = readyForStaging;

const report = {
  generatedAt: new Date().toISOString(),
  criteria: {
    staging: {
      releaseStagesHealthy,
      metricsRegressionPassed: metrics.passed,
      infraSmokePassed: infra.passed,
      functionalSmokePassed: functional.passed,
      rule: "release stages + metrics + infra smoke + functional smoke must pass",
    },
    pilot: {
      stagingReady: readyForStaging,
      criticalStageFailures,
      rule: "all staging criteria must pass with no critical stage failures",
    },
  },
  result: {
    readyForStaging,
    readyForPilot,
  },
};

fs.mkdirSync("artifacts/release", { recursive: true });
fs.writeFileSync("artifacts/release/readiness-contract.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (!readyForPilot) {
  process.exit(1);
}
