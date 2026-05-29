# H.A.M.M.E.R. V3 Operations

## Cash session auto-close cron

The production source of truth for daily operation is:

- `OperationalDay` for branch day state.
- `CashSession` for cash box state.
- `CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW` for automatic closes that still require human review.

`CashClosure` is legacy/historical compatibility only. It must not decide whether sales or payments are allowed.

## Vercel Cron

`vercel.json` runs:

```json
{
  "path": "/api/system/cron/cash-auto-close",
  "schedule": "*/5 * * * *"
}
```

Vercel Cron invokes the route with `GET`. The route also accepts `POST` for controlled manual/system execution. Both methods require:

```text
Authorization: Bearer ${CRON_SECRET}
```

`CRON_SECRET` is mandatory in every environment where the route is used. Vercel automatically sends it as the `Authorization` header when the project has a `CRON_SECRET` environment variable configured.

The query fallback `?secret=...` is supported only for controlled operational calls where a header cannot be set. It is checked against the same `CRON_SECRET`.

## Schedule Rules

The cron runs every five minutes. The service decides whether a session is eligible:

- Monday-Friday: close at or after 17:20 `America/Managua`.
- Saturday: close at or after 16:00 `America/Managua`.
- Sunday: automatic close disabled.

## Auto-close Behavior

Automatic close only scans `CashSession` rows with `status = OPEN`.

When eligible, the service locks the row in a transaction and confirms it is still `OPEN` before updating. This makes repeated or overlapping cron invocations idempotent.

The auto-close update sets:

- `status = AUTO_CLOSED_PENDING_REVIEW`
- `autoClosedAt = now`
- `autoClosedBySystem = true`
- `autoClosedReason = "Cierre automatico por horario operativo."`
- `requiresReview = true`
- `expectedCashAmount = calculated expected cash`
- `countedCashAmount = null`
- `differenceAmount = null`

The service never sets counted cash automatically and never assumes the box balanced.

## Human Review

An auto-closed cash session requires manual review with:

- `countedCashAmount`
- `note`
- proper cash session permission

Review calculates the final difference, closes the session, refreshes the `OperationalDay` summary, and resolves the related Brain decision.

## Dry Run And Time Override

`?dryRun=1` returns the sessions that would be closed without modifying the database.

`?now=...` is available only outside production and is intended for schedule validation.
