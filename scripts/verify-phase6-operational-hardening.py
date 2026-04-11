from pathlib import Path

checks: list[tuple[str, bool, str]] = []

def add(name: str, ok: bool, detail: str):
    checks.append((name, ok, detail))

cash_service = Path('src/modules/cash-session/service.ts').read_text()
cash_open = Path('src/app/api/cashier/cash-sessions/open/route.ts').read_text()
cash_close_req = Path('src/app/api/cashier/cash-sessions/close-request/route.ts').read_text()
cash_close = Path('src/app/api/cashier/cash-sessions/close/route.ts').read_text()

payments_service = Path('src/modules/payments/service.ts').read_text()

dispatch_service = Path('src/modules/dispatch/service.ts').read_text()
dispatch_route = Path('src/app/api/warehouse/dispatch/[orderId]/dispatch/route.ts').read_text()
dispatch_pending = Path('src/app/api/warehouse/dispatch/pending/route.ts').read_text()

cash_events = Path('src/modules/cash-session/audit-events.ts').read_text()
dispatch_events = Path('src/modules/dispatch/audit-events.ts').read_text()

# Positive lifecycle contracts
add('payment_transitions_dispatch_pending', 'SaleOrderStatus.DISPATCH_PENDING' in payments_service, 'payment must transition to DISPATCH_PENDING')
add('dispatch_transitions_dispatched', 'status: SaleOrderStatus.DISPATCHED' in dispatch_service or 'SaleOrderStatus.DISPATCHED' in dispatch_service, 'dispatch must transition to DISPATCHED')
add('dispatch_creates_ticket', 'tx.dispatchTicket.create' in dispatch_service, 'dispatch must create DispatchTicket')

# Duplicate/retry hardening
add('single_open_session_guard', 'CASH_SESSION_ALREADY_OPEN' in cash_service and 'activeSessionKey' in cash_service, 'open session must reject duplicates per cash box')
add('dispatch_atomic_transition_guard', 'updateMany' in dispatch_service and 'DISPATCH_INVALID_STATUS' in dispatch_service, 'dispatch must use status-guarded transition to resist replay')

# Negative path / reason codes
required_cash_denials = [
    'FORBIDDEN_ROLE', 'FORBIDDEN_BRANCH', 'CASH_SESSION_ALREADY_OPEN', 'CASH_SESSION_CASH_BOX_INVALID',
    'CASH_SESSION_NOT_OPEN', 'CASH_SESSION_NOT_RECONCILING', 'CASH_SESSION_UNRESOLVED_ORDERS',
]
for reason in required_cash_denials:
    add(f'cash_denial_{reason.lower()}', reason in (cash_service + cash_open + cash_close_req + cash_close), f'missing cash denial reason {reason}')

required_dispatch_denials = ['FORBIDDEN_ROLE', 'FORBIDDEN_BRANCH', 'DISPATCH_INVALID_STATUS', 'DISPATCH_ALREADY_COMPLETED']
for reason in required_dispatch_denials:
    add(f'dispatch_denial_{reason.lower()}', reason in (dispatch_service + dispatch_route + dispatch_pending), f'missing dispatch denial reason {reason}')

# Audit event constants
for ev in ['CASH_SESSION_OPENED', 'CASH_SESSION_CLOSE_REQUESTED', 'CASH_SESSION_CLOSED', 'CASH_SESSION_DENIED']:
    add(f'audit_cash_{ev.lower()}', ev in cash_events, f'missing cash audit event {ev}')

for ev in ['ORDER_DISPATCHED', 'ORDER_DISPATCH_DENIED']:
    add(f'audit_dispatch_{ev.lower()}', ev in dispatch_events, f'missing dispatch audit event {ev}')

failed = [item for item in checks if not item[1]]
for name, ok, detail in checks:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")

if failed:
    raise SystemExit(1)

print(f"\nAll checks passed: {len(checks)}")
