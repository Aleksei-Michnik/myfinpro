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

## Iteration 10.2 — BudgetModule CRUD API (2026-07-13, journal backfilled 2026-07-17)

Per design §5. Shipped in `c61b841` + `e1d9097` (module files were
initially missed from the commit — hence the follow-up).

### Scope

- **`BudgetModule`** (`apps/api/src/budget/`) — controller + service +
  DTOs + `BUDGET_*` error constants. Endpoints: `POST/GET /budgets`,
  `GET/PATCH/DELETE /budgets/:id`, `POST /budgets/:id/archive` /
  `unarchive`. Personal budgets owner-only; group budgets require ADMIN
  for mutations, member for reads; non-accessors get 404 (existence not
  leaked), members editing get the one deliberate 403. Currency defaults
  from owner/group `defaultCurrency`; CUSTOM period bounds validated;
  category checked for scope visibility + OUT direction. Cursor-paginated
  list with `scope=personal|group:<id>|all` + `includeArchived`. Audit
  actions (`BUDGET_CREATED/UPDATED/DELETED/ARCHIVED/UNARCHIVED`) and
  advisory `budget.updated` SSE on every mutation. Transaction-tier
  throttles (30/min mutations, 120/min reads).

### Tests

Controller + service unit specs (scope matrix owner/admin/member/
outsider, validation branches) and
`budgets-crud.integration.spec.ts` (~700 lines) covering the full CRUD +
archive lifecycle against Testcontainers MariaDB.

### Design revision (2026-07-17, pre-10.3)

Reviewed the remaining design with four recorded decisions
(design doc §2.5, §3, §9):

1. **Alert evaluation is event-driven + hourly backstop** — a
   `transaction.*` listener enqueues targeted evaluation jobs;
   the hourly sweep catches missed/backdated cases.
2. **Alerts re-arm on material edit** — PATCH deletes the current
   period's fired rows when amount/currency/category/period/threshold
   change.
3. **The 10.1 composite dedup unique is broken on MariaDB** (NULLs are
   distinct in unique indexes; every row has a NULL FK) — replaced by a
   required computed `dedup_key` column + unique, migrating in 10.9
   while the table is empty.
4. **Low-balance warnings formally deferred** (no account/balance
   concept yet; revisit with Phase 12.9).

**Next** — 10.3 (`CreateBudgetDialog` + `BudgetFormDialog`, i18n EN+HE).
