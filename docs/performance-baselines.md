# POS Performance Baselines

## Action targets (frontend)

| Action | Target (ms) | Metric key | Source |
|---|---:|---|---|
| Search latency | <= 180 | `search_latency` | `measurePosMetric` |
| Add to ticket | <= 350 | `add_to_ticket_latency` | `measurePosMetric` |
| Payment latency | <= 1200 | `payment_latency` | `measurePosMetric` |
| Dispatch latency | <= 900 | `dispatch_latency` | `measurePosMetric` |

## Behavior
- Metrics are measured client-side with low overhead using `performance.now()`.
- Console output:
  - `console.info("[POS_METRIC]")` when inside threshold.
  - `console.warn("[POS_METRIC_WARNING]")` when exceeded.
- The UI emits `window` event `hammer:pos-metric` for optional collector integrations.

## Known bottlenecks to monitor
- Slow network/API response spikes in payment and dispatch actions.
- Large product datasets where search API response size dominates.
- Browsers/devices with low CPU where virtual list scroll calculations can jitter.

## Future E2E automation notes
- Collect and assert emitted telemetry events during Playwright runs.
- Add threshold assertions per environment profile (dev/staging/prod-like).
