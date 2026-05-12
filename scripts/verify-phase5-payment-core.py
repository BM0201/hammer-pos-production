from pathlib import Path

checks: list[tuple[str, bool, str]] = []


def add(name: str, ok: bool, detail: str):
    checks.append((name, ok, detail))


policy = Path("src/modules/payments/policy.ts").read_text()
service = Path("src/modules/payments/service.ts").read_text()
payments_route = Path("src/app/api/cashier/payments/route.ts").read_text()
pending_route = Path("src/app/api/cashier/orders/pending-payment/route.ts").read_text()
inventory_route = Path("src/app/api/inventory/movements/route.ts").read_text()
audit_events = Path("src/modules/payments/audit-events.ts").read_text()
inventory_service = Path("src/modules/inventory/service.ts").read_text()
cashier_payments_ui = Path("src/components/payments/cashier-payments.tsx").read_text()
release_check = Path("scripts/release-check.sh").read_text()

# policy explicitness
add(
    "explicit_payment_post_roles",
    "PAYMENT_POSTING_ROLES" in policy and "CASHIER" in policy,
    "payment posting roles should be explicit",
)
add(
    "explicit_payment_view_roles",
    "PAYMENT_VIEW_ROLES" in policy,
    "payment view roles should be explicit",
)

# required routes exist with role/branch checks (legacy or capability-based)
add(
    "payments_route_role_guard",
    "canPostPayment" in payments_route
    or ("canInAnyAssignedBranch" in payments_route and "CAPABILITIES.CASH_PAYMENTS_COLLECT" in payments_route),
    "payments route missing role guard",
)
add(
    "payments_route_branch_guard",
    ("hasBranchAccess" in payments_route and "isMaster" in payments_route)
    or ("canInBranch" in payments_route and "isMaster" in payments_route),
    "payments route missing branch guard",
)
add(
    "pending_route_view_guard",
    "canViewPendingPayments" in pending_route
    or ("canInAnyAssignedBranch" in pending_route and "CAPABILITIES.CASH_PAYMENTS_VIEW" in pending_route),
    "pending orders route missing role guard",
)

# service flow
add(
    "payment_requires_pending_status",
    "SaleOrderStatus.PENDING_PAYMENT" in service and "PAYMENT_INVALID_STATUS" in service,
    "service must enforce pending status only",
)
add(
    "payment_transitions_dispatch_pending_or_auto_dispatch",
    "SaleOrderStatus.DISPATCH_PENDING" in service and "nextStatus" in service,
    "service must transition order to DISPATCH_PENDING (or adaptive dispatch flow)",
)
add("payment_persists_record", "tx.payment.create" in service, "service must create payment record")
add(
    "payment_requires_explicit_cash_session_payload",
    "cashSessionId" in Path("src/modules/payments/validators.ts").read_text(),
    "payment payload must include explicit cashSessionId",
)
add(
    "payment_requires_cash_session",
    "INVALID_CASH_SESSION" in service and "CashSessionStatus.OPEN" in service,
    "service must require explicit active cash session",
)
add(
    "payment_deducts_inventory_sale_out",
    "InventoryMovementType.SALE_OUT" in service and "createInventoryMovementTx" in service,
    "payment must deduct inventory through domain flow",
)

# guard against bypasses
add(
    "generic_inventory_still_blocks_sale_out",
    'movementType === "SALE_OUT"' in inventory_route and "only allowed through the sales workflow" in inventory_route,
    "generic inventory endpoint must still block SALE_OUT",
)
add(
    "inventory_tx_helper_exists",
    "createInventoryMovementTx" in inventory_service,
    "inventory tx helper must exist for orchestrated payment flow",
)
add(
    "inventory_uses_for_update_lock",
    "FOR UPDATE" in inventory_service,
    "inventory service must lock balance rows with SELECT ... FOR UPDATE",
)
add(
    "payment_flow_uses_for_update_lock",
    "FOR UPDATE" in service,
    "payment flow must lock inventory balance rows before deduction",
)

# audit normalization
required_events = [
    "PAYMENT_POSTED",
    "PAYMENT_DENIED",
    "PAYMENT_INVENTORY_DEDUCTION_SUCCESS",
    "PAYMENT_INVENTORY_DEDUCTION_FAILED",
]
for event in required_events:
    add(f"audit_event_{event.lower()}", event in audit_events, f"missing audit event constant: {event}")

required_reasons = [
    "FORBIDDEN_ROLE",
    "FORBIDDEN_BRANCH",
    "INVALID_CASH_SESSION",
    "CASH_SESSION_NOT_OPEN",
    "CASH_BOX_BRANCH_MISMATCH",
    "CASH_BOX_INACTIVE",
]
for reason in required_reasons:
    add(
        f"denial_reason_{reason.lower()}",
        reason in (service + payments_route),
        f"missing denial reason: {reason}",
    )

# UI guards + release check baseline
add(
    "cashier_ui_disables_submit_without_open_session",
    "!cashSessionState.hasOpenSession" in cashier_payments_ui or "!canSubmitPayment" in cashier_payments_ui,
    "cashier UI must block submit when there is no open session",
)
add(
    "cashier_ui_sends_cash_session_id",
    "cashSessionId: cashSessionState.cashSessionId" in cashier_payments_ui,
    "cashier UI must send explicit cashSessionId",
)
add(
    "route_maps_invalid_amount_400",
    'INVALID_PAYMENT_AMOUNT: 400' in payments_route,
    "payments route must map INVALID_PAYMENT_AMOUNT to 400",
)
add(
    "route_maps_double_payment_409",
    'PAYMENT_ALREADY_POSTED: 409' in payments_route,
    "payments route must map PAYMENT_ALREADY_POSTED to 409",
)
add(
    "release_check_includes_build",
    "npm run build" in release_check,
    "release check must execute build",
)

failed = [item for item in checks if not item[1]]
for name, ok, detail in checks:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")

if failed:
    raise SystemExit(1)

print(f"\nAll checks passed: {len(checks)}")
