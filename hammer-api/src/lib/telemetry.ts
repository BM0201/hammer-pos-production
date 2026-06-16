export type PosMetricName = "search_latency" | "add_to_ticket_latency" | "payment_latency" | "dispatch_latency";

type MetricPayload = {
  metric: PosMetricName;
  elapsedMs: number;
  thresholdMs: number;
  exceeded: boolean;
  success: boolean;
  context?: Record<string, unknown>;
  at: string;
};

export const POS_PERF_BASELINES_MS: Record<PosMetricName, number> = {
  search_latency: 180,
  add_to_ticket_latency: 350,
  payment_latency: 1200,
  dispatch_latency: 900,
};

export function measurePosMetric(metric: PosMetricName, context?: Record<string, unknown>) {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();

  return (success: boolean) => {
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsedMs = Math.round((end - start) * 100) / 100;
    const thresholdMs = POS_PERF_BASELINES_MS[metric];
    const exceeded = elapsedMs > thresholdMs;

    const payload: MetricPayload = {
      metric,
      elapsedMs,
      thresholdMs,
      exceeded,
      success,
      context,
      at: new Date().toISOString(),
    };

    if (typeof window !== "undefined") {
      if (exceeded) {
        console.warn("[POS_METRIC_WARNING]", payload);
      } else {
        console.info("[POS_METRIC]", payload);
      }

      window.dispatchEvent(new CustomEvent("hammer:pos-metric", { detail: payload }));
    }

    return payload;
  };
}
