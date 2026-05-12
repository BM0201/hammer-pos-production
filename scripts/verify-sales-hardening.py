from pathlib import Path

checks: list[tuple[str, bool, str]] = []


def add(name: str, ok: bool, detail: str):
    checks.append((name, ok, detail))


policy = Path("src/modules/sales/policy.ts").read_text()
service = Path("src/modules/sales/service.ts").read_text()
orders_route = Path("src/app/api/sales/orders/route.ts").read_text()
lines_route = Path("src/app/api/sales/orders/[id]/lines/route.ts").read_text()
line_mutation_route = Path("src/app/api/sales/orders/[id]/lines/[lineId]/route.ts").read_text()
submit_route = Path("src/app/api/sales/orders/[id]/submit/route.ts").read_text()
audit_events = Path("src/modules/sales/audit-events.ts").read_text()

# 1) Explicit role whitelists
add(
    "explicit_view_whitelist",
    "SALES_VIEW_ROLES" in policy and 'role !== "WAREHOUSE"' not in policy,
    "canViewSales must use explicit whitelist",
)
add(
    "draft_manager_whitelist",
    "SALES_DRAFT_MANAGER_ROLES" in policy,
    "canManageSalesDraft must use explicit whitelist",
)

# 2) Audit naming normalization
expected_events = [
    "ORDER_CREATED",
    "ORDER_CREATE_DENIED",
    "ORDER_LINE_ADDED",
    "ORDER_LINE_UPDATED",
    "ORDER_LINE_REMOVED",
    "ORDER_LINE_MUTATION_DENIED",
    "ORDER_SUBMITTED_PENDING_PAYMENT",
    "ORDER_SUBMIT_DENIED",
]
for event in expected_events:
    add(f"audit_event_{event.lower()}", event in audit_events, f"missing {event} in audit constants")

legacy_events = ["SALE_ORDER_LINE_ADD_DENIED"]
for legacy in legacy_events:
    add(
        f"legacy_event_removed_{legacy.lower()}",
        legacy not in lines_route + line_mutation_route + submit_route + orders_route + service,
        f"legacy event still present: {legacy}",
    )

# 3) Role + branch checks in all mutations
route_guard_tokens = {
    "create_order": "CAPABILITIES.SALES_DRAFT_MANAGE",
    "add_line": "CAPABILITIES.SALES_DRAFT_MANAGE",
    "update_delete_line": "CAPABILITIES.SALES_DRAFT_MANAGE",
    "submit_order": "CAPABILITIES.SALES_SUBMIT_PAYMENT",
}

for name, content in {
    "create_order": orders_route,
    "add_line": lines_route,
    "update_delete_line": line_mutation_route,
    "submit_order": submit_route,
}.items():
    role_ok = (
        "canManageSalesDraft" in content
        or (
            "canInAnyAssignedBranch" in content
            and route_guard_tokens[name] in content
        )
    )
    add(f"{name}_role_guard", role_ok, f"{name} missing role guard")

for name, content in {
    "create_order": orders_route,
    "add_line": lines_route,
    "update_delete_line": line_mutation_route,
    "submit_order": submit_route,
}.items():
    branch_ok = (
        (
            "hasBranchAccess" in content and "isMaster" in content
        )
        or "checkBranch(" in content
        or ("canInBranch" in content and "isMaster" in content)
    )
    add(f"{name}_branch_guard", branch_ok, f"{name} missing branch guard")

# 4) Totals recalc + transition checks
add(
    "recalc_after_add",
    "const orderUpdated = await recalcOrderTotalsTx(tx, input.saleOrderId);" in service,
    "missing recalc call in line mutation path",
)
add(
    "submit_requires_draft",
    "if (order.status !== SaleOrderStatus.DRAFT)" in service and 'throw new Error("INVALID_TRANSITION")' in service,
    "missing invalid transition guard",
)
add(
    "submit_requires_non_empty",
    "if (lines.length === 0)" in service and 'throw new Error("ORDER_EMPTY")' in service,
    "missing empty-order guard",
)
add(
    "submit_insufficient_stock_denial",
    'throw new Error("INSUFFICIENT_STOCK")' in service and 'reason: "INSUFFICIENT_STOCK"' in service,
    "missing insufficient stock guard/audit",
)

# NOTE: inventory deduction now can exist in orchestrated direct-sale/payment flows.
# Validate only that submit-to-pending path remains present.
add(
    "submit_to_pending_payment_flow_present",
    "submitSaleOrderToPendingPayment" in service,
    "sales submit flow missing",
)

failed = [item for item in checks if not item[1]]
for name, ok, detail in checks:
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name}: {detail}")

if failed:
    raise SystemExit(1)

print(f"\nAll checks passed: {len(checks)}")
