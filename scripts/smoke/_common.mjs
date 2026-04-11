import fs from "node:fs";

export const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";

export async function checkHttp({ name, path, method = "GET", expectedStatuses, body, headers }) {
  const url = `${baseUrl}${path}`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        ...(headers ?? {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });

    const durationMs = Date.now() - started;
    const passed = expectedStatuses.includes(response.status);

    return {
      name,
      target: url,
      status: response.status,
      passed,
      durationMs,
      details: passed ? "reachable" : `unexpected status ${response.status}`,
    };
  } catch (error) {
    return {
      name,
      target: url,
      status: null,
      passed: false,
      durationMs: Date.now() - started,
      details: error instanceof Error ? error.message : "unknown error",
    };
  }
}

export function summarize(checks, phase, startedAt) {
  const failed = checks.filter((item) => !item.passed);
  return {
    phase,
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    passed: failed.length === 0,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    checks,
  };
}

export function emitAndExit(report) {
  const output = JSON.stringify(report, null, 2);
  console.log(output);
  if (process.env.SMOKE_REPORT_PATH) {
    fs.mkdirSync("artifacts/smoke", { recursive: true });
    fs.writeFileSync(process.env.SMOKE_REPORT_PATH, output);
  }
  if (!report.passed) {
    process.exit(1);
  }
}
