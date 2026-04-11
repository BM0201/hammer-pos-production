from pathlib import Path

checks: list[tuple[str, bool, str]] = []

def add(name: str, ok: bool, detail: str):
    checks.append((name, ok, detail))

telemetry = Path('src/lib/telemetry.ts').read_text()
pos = Path('src/components/pos/branch-pos.tsx').read_text()
payments = Path('src/components/payments/cashier-payments.tsx').read_text()
dispatch = Path('src/components/dispatch/dispatch-workspace.tsx').read_text()
package = Path('package.json').read_text()
playwright_cfg = Path('playwright.config.ts').read_text()

actions = ['search_latency', 'add_to_ticket_latency', 'payment_latency', 'dispatch_latency']
for action in actions:
    add(f'baseline_{action}', action in telemetry, f'missing telemetry baseline for {action}')

add('pos_search_metric', 'measurePosMetric("search_latency"' in pos, 'POS search metric missing')
add('pos_add_metric', 'measurePosMetric("add_to_ticket_latency"' in pos, 'POS add-to-ticket metric missing')
add('payment_metric', 'measurePosMetric("payment_latency"' in payments, 'payment metric missing')
add('dispatch_metric', 'measurePosMetric("dispatch_latency"' in dispatch, 'dispatch metric missing')

selectors = ['pos-root', 'cashier-payments-root', 'dispatch-root']
for sel in selectors:
    add(f'selector_{sel}', sel in (pos + payments + dispatch), f'missing test selector {sel}')

add('playwright_script', 'test:e2e' in package, 'missing npm e2e script')
add('quality_gate_script', 'quality:gate' in package, 'missing npm quality gate script')
add('playwright_config_exists', 'defineConfig' in playwright_cfg and 'tests/e2e' in playwright_cfg, 'playwright config missing')

failed = [x for x in checks if not x[1]]
for name, ok, detail in checks:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")

if failed:
    raise SystemExit(1)

print(f"\nAll checks passed: {len(checks)}")
