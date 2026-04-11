# H.A.M.M.E.R. Phase 1 Foundation (Architecture Baseline)

## A. Architecture decisions

1. **Architecture style: modular monolith (not microservices) for v1**
   - Single deployable backend + web frontend.
   - Strict bounded contexts at code level to avoid coupling.
   - Reason: faster delivery, lower ops burden, still scalable for 3-branch operation.

2. **Tech baseline**
   - Frontend: Next.js App Router + TypeScript (tablet-first responsive UX).
   - Backend: Next.js API route handlers / server actions for v1 (or extracted services inside same repo).
   - DB: PostgreSQL + Prisma.
   - Auth: session/JWT + RBAC/permission middleware.
   - Queue/events (later): outbox table pattern first, then optional Redis queue.

3. **Multi-branch scope model**
   - `Branch` is explicit for operational data.
   - `MASTER` is global role, **not** represented as branch.
   - `UserBranchAccess` controls allowed branches per user.

4. **Cash operations model**
   - `PhysicalCashBox` is branch asset; not tied permanently to one user.
   - `CashSession` belongs to physical cash box + opened by user.
   - DB-enforced `activeSessionKey` + unique index guarantees one active session per box.

5. **Sales operational flow separation**
   - Salesperson creates and submits order for payment.
   - Cashier handles charging and payment finalization.
   - Warehouse dispatches only after paid state.

6. **Inventory costing**
   - Official operational method: weighted average cost (WAC).
   - Inventory valuation per branch-product in `InventoryBalance`.
   - `InventoryMovement` stores quantity and unit cost snapshot per movement.
   - FIFO extensibility reserved for future reporting layer only.

7. **Approval and audit first-class**
   - `ApprovalRequest` for returns and exceptional flows.
   - `AuditLog` mandatory for critical events (payment, approvals, transfers, stock adjustments).

8. **AI assistant boundary**
   - AI module is advisory-only placeholder.
   - No direct transactional write permissions in v1.
   - Access only by MASTER (+ optional limited BRANCH_ADMIN later).

---

## B. Folder structure

```text
H.A.M.M.E.R/
├─ docs/
│  ├─ phase-1-foundation.md
│  ├─ product-glossary.md
│  └─ adr/
│     ├─ ADR-001-modular-monolith.md
│     ├─ ADR-002-branch-scope-and-rbac.md
│     └─ ADR-003-weighted-average-cost.md
├─ prisma/
│  ├─ schema.prisma
│  ├─ seed.ts
│  └─ migrations/
├─ src/
│  ├─ app/
│  │  ├─ (auth)/
│  │  ├─ (backoffice)/
│  │  ├─ (pos)/
│  │  └─ api/
│  ├─ modules/
│  │  ├─ auth/
│  │  ├─ branches/
│  │  ├─ users/
│  │  ├─ roles/
│  │  ├─ catalog/
│  │  ├─ inventory/
│  │  ├─ customers/
│  │  ├─ credits/
│  │  ├─ sales/
│  │  ├─ cashier/
│  │  ├─ dispatch/
│  │  ├─ approvals/
│  │  ├─ transfers/
│  │  ├─ audit/
│  │  ├─ reporting/      # placeholder
│  │  ├─ timber/         # placeholder
│  │  └─ ai-assistant/   # placeholder
│  └─ shared/
│     ├─ kernel/
│     ├─ types/
│     └─ utils/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
├─ package.json
├─ tsconfig.json
└─ README.md
```

---

## C. Module boundaries

1. **auth**: login/session/token lifecycle.
2. **branches**: branch metadata, branch status, governance constraints.
3. **users**: user profile lifecycle.
4. **roles/permissions**: role catalog, permission grants.
5. **catalog**: categories/products/pricing base data.
6. **inventory**: balances, movements, stock adjustments, costing update.
7. **customers**: customer identity and tax/commercial data.
8. **credits**: credit profile, limits, exposure, scope checks.
9. **sales**: quote/order creation and lifecycle until payment pending.
10. **cashier**: cash sessions, payments, receipt/ticket events.
11. **dispatch**: post-payment fulfillment and delivery/dispatch records.
12. **approvals**: approval requests/resolutions for returns & exceptions.
13. **transfers**: inter-branch stock transfer lifecycle.
14. **audit**: immutable event logging + traceability.
15. **reporting**: placeholder read models/analytics.
16. **timber**: placeholder intake/cubicación pipeline (future).
17. **ai-assistant**: placeholder advisory insights (future, read-first).

Boundary rule: modules interact through explicit services/contracts, not direct table poking across modules except through designated repositories.

---

## D. Prisma schema v1 draft

- Full draft is defined in `prisma/schema.prisma` and hardened by `prisma/migrations/20260329120000_phase1_hardening/migration.sql`.
- Covers all required entities: Branch, User, Role, UserBranchAccess, PhysicalCashBox, CashSession, Customer, CustomerBranchScope, CustomerCreditProfile, Category, Product, InventoryBalance, InventoryMovement, SaleOrder, SaleOrderLine, Payment, DispatchTicket, ApprovalRequest, Transfer, TransferLine, AuditLog.
- Includes explicit enums for state machines and key operational rules (including `CurrencyCode`).
- Enforces explicit branch scoping and separation of physical cash box from user identity.
- Supports weighted average cost as primary operational costing at `InventoryBalance.weightedAverageCost`, with non-negative and quantity checks added at DB layer.
- Keeps timber integration path clean with `InventoryMovementType.TIMBER_INTAKE_IN` without implementing timber module yet.

---

## E. Role/permission matrix

Legend: ✅ allowed, ◐ conditional/approval, ❌ not allowed.

| Capability | MASTER | BRANCH_ADMIN | SALESPERSON | CASHIER | WAREHOUSE |
|---|---:|---:|---:|---:|---:|
| View all branches | ✅ | ❌ | ❌ | ❌ | ❌ |
| View own branch dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manage users in own branch | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create/edit product catalog | ✅ | ◐ (branch pricing only) | ❌ | ❌ | ❌ |
| Create sale order draft | ✅ | ✅ | ✅ | ❌ | ❌ |
| Send order to pending payment | ✅ | ✅ | ✅ | ❌ | ❌ |
| Open/close cash session | ✅ | ◐ (if delegated) | ❌ | ✅ | ❌ |
| Register payment | ✅ | ❌ | ❌ | ✅ | ❌ |
| Print thermal ticket | ✅ | ❌ | ❌ | ✅ | ❌ |
| Mark order dispatched | ✅ | ✅ | ❌ | ❌ | ✅ |
| Create return request | ✅ | ✅ | ✅ | ✅ | ✅ |
| Approve return | ✅ | ◐ (local limits) | ❌ | ❌ | ❌ |
| Manage customer credit profile | ✅ | ◐ (local only) | ❌ | ❌ | ❌ |
| Execute transfer out/in | ✅ | ✅ (own branch scope) | ❌ | ❌ | ◐ (receive confirmation) |
| Access AI assistant | ✅ | ◐ (read-only subset) | ❌ | ❌ | ❌ |

Minimum permission keys:
- `sales.order.create`, `sales.order.submit_for_payment`
- `cash.session.open`, `cash.session.close`, `cash.payment.create`
- `dispatch.ticket.process`
- `approval.request.create`, `approval.request.resolve`
- `transfer.create`, `transfer.approve`, `transfer.dispatch`, `transfer.receive`
- `credit.profile.manage`
- `ai.assistant.read`

---

## F. Route map

### Auth
- `/login`
- `/logout`

### Backoffice (MASTER / BRANCH_ADMIN)
- `/app/dashboard`
- `/app/branches`
- `/app/users`
- `/app/roles`
- `/app/catalog/categories`
- `/app/catalog/products`
- `/app/customers`
- `/app/credits`
- `/app/inventory/balances`
- `/app/inventory/movements`
- `/app/transfers`
- `/app/approvals`
- `/app/audit`
- `/app/reports` (placeholder)
- `/app/timber` (placeholder)
- `/app/ai-assistant` (placeholder, restricted)

### Operational role workspaces
- `/pos/sales` (salesperson order creation)
- `/pos/cashier/session`
- `/pos/cashier/checkout`
- `/pos/dispatch/pending`
- `/pos/dispatch/history`

### Core API groups
- `/api/auth/*`
- `/api/branches/*`
- `/api/users/*`
- `/api/catalog/*`
- `/api/inventory/*`
- `/api/customers/*`
- `/api/credits/*`
- `/api/sales/*`
- `/api/cashier/*`
- `/api/dispatch/*`
- `/api/approvals/*`
- `/api/transfers/*`
- `/api/audit/*`

---

## G. State machines

### 1) Sale order
- `DRAFT`
  - -> `PENDING_PAYMENT` (salesperson submits)
  - -> `CANCELLED` (before payment)
- `PENDING_PAYMENT`
  - -> `PAID` (cashier posts full payment)
  - -> `CANCELLED` (authorized cancel)
- `PAID`
  - -> `DISPATCH_PENDING` (automatic)
- `DISPATCH_PENDING`
  - -> `DISPATCHED` (warehouse confirms)
  - -> `RETURN_REQUESTED` (return initiation)
- `RETURN_REQUESTED`
  - -> `RETURN_APPROVED`
  - -> `RETURN_REJECTED`
- `RETURN_APPROVED`
  - -> `RETURNED` (stock/payment reversal flow complete)

### 2) Cash session
- `CLOSED`
  - -> `OPEN` (open session with opening amount)
- `OPEN`
  - -> `RECONCILING` (close requested)
- `RECONCILING`
  - -> `CLOSED` (validated and posted)
  - -> `OPEN` (reopen reconcile due mismatch resolution)
Constraint: one `OPEN` session per `PhysicalCashBox`.

### 3) Return approval
- `REQUESTED`
  - -> `UNDER_REVIEW`
- `UNDER_REVIEW`
  - -> `APPROVED`
  - -> `REJECTED`
- `APPROVED`
  - -> `EXECUTED` (inventory/payment updates applied)
- `REJECTED`
  - -> terminal

### 4) Transfer
- `DRAFT`
  - -> `REQUESTED`
- `REQUESTED`
  - -> `APPROVED`
  - -> `REJECTED`
- `APPROVED`
  - -> `IN_TRANSIT` (origin dispatch)
- `IN_TRANSIT`
  - -> `RECEIVED` (destination reception)
  - -> `PARTIALLY_RECEIVED` (optional interim)
- `PARTIALLY_RECEIVED`
  - -> `RECEIVED`
- `RECEIVED`
  - -> terminal

---

## H. Seed plan

### Branches
- `MGA` Managua (default supplying branch = true)
- `MSY` Masaya
- `RIV` Rivas

### Physical cash boxes
- One per branch:
  - `CASH-MGA-01`
  - `CASH-MSY-01`
  - `CASH-RIV-01`

### Roles
- `MASTER`, `BRANCH_ADMIN`, `SALESPERSON`, `CASHIER`, `WAREHOUSE`

### Users (initial)
- 1 master user (global scope)
- 1 branch admin per branch
- 1 salesperson per branch
- 1 cashier per branch
- 1 warehouse per branch

### Catalog bootstrap
- Core categories (tools, electrical, plumbing, paint, construction, timber-placeholder-tag).
- Minimal sample SKUs for testing workflow (10–20 products).

### Customers bootstrap
- Walk-in customer (cash only).
- 2 authorized credit customers per branch.
- 1 universal credit customer (shared scope).

### Credit profiles bootstrap
- Credit limits with conservative defaults.
- Branch-scoped vs universal profile examples with DB check constraint (`UNIVERSAL` => `branchId = NULL`, `BRANCH_LOCAL` => `branchId != NULL`).

---

## I. Coding standards

1. TypeScript strict mode, `noImplicitAny` true.
2. ESLint + Prettier + import order rules.
3. Feature-first module structure; no giant “misc” services.
4. DTO validation at boundary using Zod.
5. No direct DB calls from UI components.
6. Every critical command writes an `AuditLog` entry.
7. Idempotency keys for payment and transfer receive endpoints.
8. All money fields in `Decimal` and explicit currency (`NIO`).
9. Branch-scoped queries must always include branch predicate unless role is MASTER.
10. `activeSessionKey` must be set when opening a session and cleared on close/reconcile transitions.
11. Test minimum:
    - Unit: domain services.
    - Integration: API + Prisma flows.
    - E2E: sales -> cashier -> dispatch happy path.

Naming conventions:
- DB models: PascalCase singular (`SaleOrder`).
- DB columns: camelCase.
- Enums: UPPER_SNAKE_CASE values.
- API routes: kebab-case plural resources.
- Permission keys: dot notation (`sales.order.create`).

---

## J. Migration strategy from old repo

### Port later (selective, controlled)
1. Timber cubicación formulas and validation rules (into `timber` module only).
2. Timber Excel import parsing logic (rewritten with tests, not copy-paste blobs).
3. Password hashing approach if proven secure/current.
4. Useful seed/catalog conventions.
5. Practical POS interaction ideas (UI behavior, not architecture).
6. Good audit event patterns.

### Leave behind
1. Bloated/legacy schemas with mixed concerns.
2. Tightly coupled route handlers that bypass domain boundaries.
3. Mixed HQ/store logic in same flows.
4. Legacy dashboard complexity and non-operational widgets.
5. Inconsistent API contracts and giant unstable modules.

### Method
- Build compatibility matrix per legacy feature:
  - `candidate`, `rewrite`, `discard`.
- Port only after passing:
  1) bounded-context fit,
  2) test coverage,
  3) security + maintainability review.

---

## K. Implementation roadmap

### Phase 1 (this step) – foundation
- Repo skeleton, module boundaries, schema draft, RBAC matrix, state machines.

### Phase 2 – operational core backend
- Implement auth + RBAC middleware.
- Implement branches/users/user-branch access.
- Implement catalog + inventory balance/movement + WAC service.
- Implement sales draft -> pending payment.
- Implement cashier sessions + payment posting.
- Implement dispatch pending -> dispatched.
- Implement audit logging hooks.

### Phase 3 – approvals/returns/transfers/credits
- Returns with approval workflow.
- Credit profile checks at sale submission/payment.
- Transfer lifecycle with approval and receiving.

### Phase 4 – UX hardening + reporting base
- Tablet optimization per role screens.
- Reporting placeholders with real read models.
- Performance, observability, reconciliation reports.

### Phase 5 – timber + AI assistant integration
- Add timber intake workflow plugged into inventory movements.
- Add advisory AI assistant (read-only analytics/context for MASTER).

---

## L. Exact next prompt for Phase 2

```text
Phase 2 execution for H.A.M.M.E.R.:
Implement the operational core backend in this repository using the Phase 1 foundation.

Scope for this phase only:
1) Apply Prisma schema and hardening migration, then run executable seed script for branches MGA/MSY/RIV, roles, one physical cash box per branch, and initial users.
2) Implement auth module with login endpoint and session validation middleware.
3) Implement RBAC + branch-scope guard middleware using roles and user-branch access.
4) Implement modules and APIs for:
   - catalog: categories/products (CRUD basic)
   - inventory: balances, movements, weighted-average-cost update service
   - sales: create draft order, add lines, submit to pending payment
   - cashier: open cash session, close cash session, register payment (cash only in this phase)
   - dispatch: list paid orders pending dispatch, mark dispatched
5) Enforce rule: only one OPEN cash session per physical cash box via `activeSessionKey` semantics + DB uniqueness.
6) Emit AuditLog records for critical actions (order submit, payment, session open/close, dispatch).
7) Add integration tests for happy path:
   salesperson creates order -> cashier pays -> warehouse dispatches.

Constraints:
- Do not implement timber logic yet.
- Do not implement AI assistant behavior yet (placeholder routes only).
- Keep architecture modular monolith with strict module boundaries.
- Use TypeScript strict mode and Zod validation.

Deliverables:
- Working code
- Prisma migration + seed
- Integration tests passing
- seed execution output attached (roles/branches/users/cash boxes)
- concise API docs for implemented endpoints
```
