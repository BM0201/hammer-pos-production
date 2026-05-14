from pathlib import Path

checks: list[tuple[str, bool, str]] = []


def add(name: str, ok: bool, detail: str):
    checks.append((name, ok, detail))


sales_service = Path("src/modules/sales/service.ts").read_text()
payments_service = Path("src/modules/payments/service.ts").read_text()
cash_service = Path("src/modules/cash-session/service.ts").read_text()
sales_validators = Path("src/modules/sales/validators.ts").read_text()
payments_validators = Path("src/modules/payments/validators.ts").read_text()
cash_validators = Path("src/modules/cash-session/validators.ts").read_text()
shared_validators = Path("src/modules/shared/validators.ts").read_text()
close_route = Path("src/app/api/cashier/cash-sessions/close/route.ts").read_text()
migration = Path("prisma/migrations/20260506120000_payment_one_posted_per_sale_order/migration.sql").read_text()

add(
    "sales_line_update_scoped_by_order",
    'where: { id: input.lineId, saleOrderId: input.saleOrderId }' in sales_service,
    "updateSaleOrderLine must scope by (lineId + saleOrderId)",
)
add(
    "sales_line_remove_scoped_by_order",
    'deleteMany({' in sales_service and 'deleted.count !== 1' in sales_service,
    "removeSaleOrderLine must use scoped deleteMany and validate count=1",
)
add(
    "payment_locks_sale_order",
    'FROM "SaleOrder"' in payments_service and 'FOR UPDATE' in payments_service,
    "postSaleOrderPayment must lock sale order row with FOR UPDATE",
)
add(
    "payment_handles_unique_constraint",
    'error.code === "P2002"' in payments_service and 'PAYMENT_ALREADY_POSTED' in payments_service,
    "payment flow must map DB unique violations to PAYMENT_ALREADY_POSTED",
)
add(
    "payment_unique_partial_index_migration",
    '"Payment_one_posted_per_sale_order"' in migration and "WHERE \"status\" = 'POSTED'" in migration,
    "must create partial unique index for posted payments",
)
add(
    "cash_close_expected_formula",
    "expectedCash = openingAmount + postedCashPayments - refundsOrWithdrawals" in cash_service,
    "cash close must calculate expected cash with in/out formula",
)
add(
    "cash_close_discrepancy_threshold",
    "CASH_SESSION_DISCREPANCY_REQUIRES_APPROVAL" in cash_service and "allowedThreshold" in cash_service,
    "cash close must enforce threshold and approval-required state",
)
add(
    "cash_close_route_approval_request",
    "APPROVAL_REQUESTED" in close_route and "DISCREPANCY_DETECTED" in close_route,
    "close route must create approval request and audit discrepancy",
)
add(
    "shared_numeric_schemas_present",
    all(token in shared_validators for token in ["moneySchema", "positiveMoneySchema", "quantitySchema", "percentageSchema", "positiveIntSchema"]),
    "shared validators must define reusable numeric schemas",
)
add(
    "module_validators_use_shared_schemas",
    "@/modules/shared/validators" in sales_validators
    and "@/modules/shared/validators" in payments_validators
    and "@/modules/shared/validators" in cash_validators,
    "sales/payments/cash-session validators must consume shared schemas",
)

failed = [item for item in checks if not item[1]]
for name, ok, detail in checks:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")

if failed:
    raise SystemExit(1)

print(f"\nAll checks passed: {len(checks)}")
