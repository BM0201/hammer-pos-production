import fs from "node:fs/promises";
import path from "node:path";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

class LatencyReporter implements Reporter {
  private readonly durations: number[] = [];

  onTestEnd(_test: TestCase, result: TestResult): void {
    this.durations.push(result.duration);
  }

  async onEnd(result: FullResult): Promise<void> {
    const sorted = [...this.durations].sort((a, b) => a - b);
    const metrics = {
      generatedAt: new Date().toISOString(),
      status: result.status,
      count: sorted.length,
      durationMs: {
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
      },
    };

    const outputPath = path.resolve(process.cwd(), "artifacts/metrics/e2e-latency.json");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(metrics, null, 2), "utf8");

    console.log(`[latency] p50=${metrics.durationMs.p50}ms p95=${metrics.durationMs.p95}ms p99=${metrics.durationMs.p99}ms`);
    console.log(`[latency] metrics file: ${outputPath}`);
  }
}

export default LatencyReporter;
