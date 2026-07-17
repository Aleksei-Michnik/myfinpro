# Phase 10 — Budgets & Spending Targets

## Iteration 10.1 — Shared types, resolvePeriod, and budgets schema (2026-07-04)

Kick-off of the budgets track (runs in parallel with Phase 7 — no receipt
code touched). Per [`docs/phase-10-budgets-design.md`](phase-10-budgets-design.md)
§3–§4.

### Scope

- **`packages/shared`** — `budget.types.ts`: `BUDGET_PERIODS` /
  `BudgetPeriod` (WEEKLY | MONTHLY | QUARTERLY | YEARLY | CUSTOM),
  `BUDGET_ALERT_KINDS` / `BudgetAlertKind`, `BudgetProgress` (incl.
  `excludedOtherCurrencyCount`, §2.4). `budget-period.ts`: pure,
  dependency-free `resolvePeriod(period, refDate, timezone, { offset,
customStart, customEnd })` → half-open `[start, end)` + `periodKey`
  (yyyy-mm-dd of the local period start). ISO weeks (Monday), calendar
  months/quarters/years computed in the budget's IANA timezone via
  `Intl.DateTimeFormat` (two-pass offset resolution; skipped local
  midnights fall forward). `offset` shifts to previous/next windows for
  the 10.5 `?periods=N` history bars; CUSTOM is a passthrough of the
  budget's explicit bounds and rejects offsets.
- **Prisma (expand-only migration `20260704180000_phase10_101_budgets`)** —
  `budgets` (scope personal/group mirroring attributions, optional
  category SetNull, period + CUSTOM bounds, alert config, soft-archive,
  scope+archived list indexes) and `budget_alert_events` (kind, nullable
  budget/payment Cascade FKs, `period_key`, `details` snapshot, the
  `(kind, budgetId, paymentId, periodKey)` dedup unique that makes the
  10.9 worker idempotent), plus `users.due_reminder_days` (default 3, 0
  disables — 10.10). No drops or alters of existing columns; verified
  with `prisma migrate diff` (schema ↔ migrations in sync).

### Tests

35 new `resolvePeriod` vitest cases: all period types; ISO-week year
boundary + week 53; local-vs-UTC weekday divergence; DST spring/fall in
Asia/Jerusalem and America/New_York (1h-short March, 1h-long October);
Pacific/Apia's skipped calendar day (6-day week); half-open boundary
instants; contiguous last-6-months windows; CUSTOM passthrough +
validation errors; periodKey format. Plus budget enum/shape specs.
**shared: 139 green; api: 926 green (typecheck + lint clean); web
typecheck unaffected.**

**Next** — 10.2 (`BudgetModule` CRUD + guards + `budget.updated` SSE).
