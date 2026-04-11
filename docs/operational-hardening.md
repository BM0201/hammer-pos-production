# Operational Hardening + E2E Verification (Cash Session -> Payment -> Dispatch)

## Deterministic bootstrap + validate

```bash
npm run bootstrap:validate
```

Sequence executed by the script:
1. Validate node/npm versions.
2. Ensure `package-lock.json` exists (generate with `npm install --package-lock-only` if absent).
3. Install deterministic dependencies with `npm ci`.
4. Run Prisma validate + generate.
5. Run TypeScript typecheck + build.
6. Run static hardening checks (`scripts/verify-phase6-operational-hardening.py`).

## If outbound registry access is blocked (offline/CI-safe fallback)

Use a two-stage CI pipeline:

1. **Connected build stage**
   - run `npm ci`
   - persist `node_modules` artifact + `package-lock.json`
   - run `npm run prisma:generate`

2. **Restricted stage**
   - restore `node_modules` artifact and lockfile
   - run `npm run prisma:validate`
   - run `npm run typecheck`
   - run `npm run build`
   - run `npm run verify:phase6`

This keeps validation deterministic even when registry calls are denied.

## E2E workflow verification (operational)

Prerequisites:
- seeded database
- running app
- authenticated cookie jars (cashier + warehouse + optionally master)

Playbook script:
```bash
bash scripts/e2e-operational-flow.sh
```

Expected lifecycle:
- cash session OPEN
- payment accepted for `PENDING_PAYMENT`
- order transitions to `DISPATCH_PENDING`
- dispatch action transitions order to `DISPATCHED` + creates `DispatchTicket`
- close-request moves session to `RECONCILING`
- close moves session to `CLOSED`

## Negative-path hardening rules

- No second OPEN session per cash box (`CASH_SESSION_ALREADY_OPEN`).
- Payment denied without OPEN session (`NO_ACTIVE_CASH_SESSION`).
- Dispatch denied for invalid role (`FORBIDDEN_ROLE`) or invalid branch (`FORBIDDEN_BRANCH`).
- Dispatch denied if status not `DISPATCH_PENDING` (`DISPATCH_INVALID_STATUS`).
- Replay dispatch denied if already dispatched (`DISPATCH_ALREADY_COMPLETED`).
- Cash close request denied if unresolved branch orders remain (`CASH_SESSION_UNRESOLVED_ORDERS`).
- Close denied if session is not RECONCILING (`CASH_SESSION_NOT_RECONCILING`).

## Audit matrix

| Event | Trigger | Required metadata |
|---|---|---|
| `CASH_SESSION_OPENED` | open session success | `physicalCashBoxId`, `openingAmount` |
| `CASH_SESSION_CLOSE_REQUESTED` | request close success | `reason`, `notes` |
| `CASH_SESSION_CLOSED` | close success | `closingAmount`, `notes` |
| `CASH_SESSION_DENIED` | any session denial | `reason` (+ optional context) |
| `SALE_ORDER_PAYMENT_POSTED` | payment success | `orderId`, `orderStatus`, `cashSessionId`, `lifecycleTransition` |
| `SALE_ORDER_PAYMENT_DENIED` | payment denial | `reason` |
| `ORDER_DISPATCHED` | dispatch success | `dispatchTicketId`, `previousStatus`, `newStatus` |
| `ORDER_DISPATCH_DENIED` | dispatch denial | `reason` |

## Operational acceptance checklist (DoD)

### Cash session ready
- [ ] Open/active/close-request/close endpoints pass role + branch checks.
- [ ] Denials include machine-readable reason.
- [ ] One OPEN session per cash box enforced.
- [ ] Close request blocked when unresolved branch orders exist.

### Payment flow ready
- [ ] Only `PENDING_PAYMENT` orders can be paid.
- [ ] OPEN cash session required.
- [ ] Successful payment transitions to `DISPATCH_PENDING`.
- [ ] Payment and inventory audit logs exist.

### Dispatch flow ready
- [ ] Only WAREHOUSE/BRANCH_ADMIN/MASTER can dispatch.
- [ ] Branch scope is enforced.
- [ ] Only `DISPATCH_PENDING` can dispatch.
- [ ] Dispatch creates ticket and order becomes `DISPATCHED`.
- [ ] Replay attempts return explicit denial reason.

### Master branch-safe behavior ready
- [ ] No hardcoded MGA in master operational pages.
- [ ] Explicit branch selection required for branch-dependent operations.
