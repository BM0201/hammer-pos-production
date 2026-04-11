#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function runPhase(command, reportPath) {
  const result = spawnSync("node", [command], {
    encoding: "utf8",
    env: {
      ...process.env,
      SMOKE_REPORT_PATH: reportPath,
    },
  });

  return {
    command: `node ${command}`,
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const infra = runPhase("scripts/smoke/infra-smoke.mjs", "artifacts/smoke/infra-smoke.json");
const functional = runPhase("scripts/smoke/functional-smoke.mjs", "artifacts/smoke/functional-smoke.json");

const combined = {
  startedAt: new Date().toISOString(),
  passed: infra.status === 0 && functional.status === 0,
  phases: {
    infrastructure: infra.status === 0 ? "passed" : "failed",
    functional: functional.status === 0 ? "passed" : "failed",
  },
  commands: [infra.command, functional.command],
};

console.log(JSON.stringify(combined, null, 2));

if (!combined.passed) {
  process.exit(1);
}
