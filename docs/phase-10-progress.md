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

## Iteration 10.3 — Budget form dialogs (2026-07-17)

Per design §7 — the budget creation/edit form UI in `apps/web`.

### Scope

- **`@/lib/budget`** — `types.ts` (wire types mirroring the 10.2 DTOs),
  `budget-context.tsx` (`BudgetProvider` / `useBudgets` with the full
  CRUD + archive surface, product/receipt-context conventions: optional
  `AbortSignal` on every method, rich `errorCode`-carrying errors), and
  `remember.ts` (last-used single budget scope, sharing the SSR-safe
  storage guards now exported from `@/lib/transaction/remember`).
  `parseAmountToCents` extracted from `TransactionFormDialog` into
  `@/lib/money` so both amount forms share one parser.
- **`<BudgetFormDialog>`** (`components/budget/`) — shared create/edit
  form DRY like `TransactionFormDialog`: name, amount + currency
  (defaults follow the scope's owner/group `defaultCurrency` until the
  user picks one by hand), single-select scope over the reused
  `<TransactionScopeSelector>` (locked in edit mode — scope is
  immutable per API design §5), optional OUT-category picker (reused
  `<TransactionCategoryPicker>` grew an `emptyOptionLabel` prop for the
  clearable "All spending" state; categories narrowed client-side to
  the chosen scope), period select with a CUSTOM date-range disclosure,
  alert threshold input (1–100, empty = off) + overspend toggle.
  Client-side validation mirrors the DTO rules (`noValidate` form so
  the translated per-field messages own the UX); `BUDGET_INVALID_*`
  domain errors map to fields, everything else hits the inline banner;
  save via `useAsyncOperation({ scope: 'control' })`. Edit mode PATCHes
  a minimal diff (`computeBudgetDiff`) — switching away from CUSTOM
  sends only `period` (bounds auto-clear server-side).
- **`<CreateBudgetDialog>`** — thin create-mode wrapper (POST /budgets)
  with scope/currency/category pins for the 10.7 group-page host.
- **`/budgets` route** — deliberately minimal (header + "New budget" +
  plain name list) so the dialog is reachable and deployable; the full
  cards/filters/archived page is 10.4. `BudgetProvider` mounted in the
  locale layout; Budgets nav item added to the sidebar (chart-pie icon).
- **i18n** — new `budgets.*` namespace (list + form + validation) in EN
  and HE; dark-mode variants throughout, matching neighboring dialogs.

### Tests

28 new `BudgetFormDialog` vitest cases: scope remember pre-fill +
defaults override + persistence on save; single-select scope semantics;
currency-follows-scope (and manual-pick stickiness); scope-narrowed
category options + invisible-category drop; CUSTOM disclosure
show/hide; validation branches (name/amount/scope/threshold/custom
range); create payload minimal + full shapes; API error banner vs
`BUDGET_INVALID_CATEGORY` field mapping; edit prefill, locked scope,
minimal diff, explicit-null threshold clear, CUSTOM→MONTHLY period-only
diff, no-op save skip; focus + ESC/discard a11y. **web: 1234 green
(106 files); typecheck + lint clean.**

**Next** — 10.4 (`/budgets` list page: cards, filters, archived toggle,
edit/delete/archive flows wired).

## Iteration 10.4 — /budgets list page (2026-07-20)

Per design §7 — the full budgets list UI in `apps/web`, replacing the
deliberately-minimal 10.3 page.

### Scope

- **`/budgets` orchestrator** (`budgets-client.tsx`) — the /transactions
  commit pattern: the visual controls (scope tabs reusing
  `<TransactionsScopeTabs>`, show-archived toggle) bind to _committed_
  filters only; a pending intent stays invisible until its fetch
  commits; failures open `<RetryReturnDialog>` (with a newest-fetch
  guard so a superseded run can't pop the dialog). Filters map to the
  10.2 list API (`scope=personal|group:<id>|all`, `includeArchived=`);
  cursor "load more" with replace-on-first-page / dedupe-append
  semantics (receipts-page pattern). Realtime per conventions:
  `budget.updated` events, reconnect-after-gap resyncs, and locale
  flips all refetch the committed first page. `budget.updated` added to
  the web `RealtimeEvent` union (the API half shipped in 10.2).
- **`<BudgetCard>`** — name, formatted amount (`formatAmount`), scope
  chip (Personal / group name via `formatScopeLabel`), category chip
  (icon + name, or the form's "All spending"), period label (CUSTOM
  renders its date range), archived styling + chip. No progress bar —
  the progress row slots in under the chips once 10.5 ships the API
  (10.6 wires it); nothing is faked. ⋮ menu (`<RowActionsMenu>`): edit
  (disabled while archived — the API rejects with `BUDGET_ARCHIVED`),
  archive/unarchive, delete; hidden entirely on group budgets for
  non-admin members (the API 403s their mutations, design §2.3).
- **Flows** — edit opens `<BudgetFormDialog>` in edit mode
  (replace-by-id on save); delete confirms via the 8.27 generic
  `<ConfirmDialog>` then hard-deletes; archive/unarchive share one
  control-scope op with success/error toasts. A freshly-archived budget
  drops out of a hide-archived list; local state updates on the HTTP
  response, never the SSE echo.
- **i18n** — `budgets.list.*` additions + `budgets.delete.*` in EN and
  HE; the card's period/category labels reuse the existing
  `budgets.form.*` keys and the scope chip reuses `transactions.scope.*`
  (one key per value). Dark-mode variants throughout; the card layout is
  RTL-safe (logical flex/gap, no directional margins).

### Tests

18 new `budgets-client` vitest cases: card fields (scope/category
chips, period incl. the CUSTOM range, archived styling); tabs commit
only after the fetch succeeds + `scope=` mapping; `includeArchived=`
mapping both ways; cursor pagination + dedupe; edit open /
replace-on-save + disabled-while-archived; member-role menu gating;
delete confirm/cancel; archive removal vs unarchive replace-in-place +
toasts; failed-archive error toast; `budget.updated` refetch with the
committed filters; resync refetch; recovery dialog + retry;
create-refetch. Plus `e2e/budgets.spec.ts` — live-stack happy-path
smoke (create → card → edit → archive → show archived → unarchive →
delete), same fresh-user convention as the payments/receipts suites.
**web: 1347 green (118 files); typecheck + lint clean.**

**Next** — 10.5 (progress service + GET /budgets/:id/progress).
