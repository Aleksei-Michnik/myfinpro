# Analytics and budgets (checked 2026-09-24)

Read when: touching `apps/api/src/analytics/**`, `apps/api/src/budget/**`, `packages/shared/src/{types/analytics.types.ts,types/budget.types.ts,budget-period.ts}`, the `/budgets` web route, or anything that must keep spend totals exact.

## Status at a glance

Phases 9 and 10 are both **in progress** and run in parallel: 9 needs receipts+products (Phases
7–8), 10 only needs transactions (Phase 6).

| Track        | Shipped                                                    | Next iteration                                | Source                                            |
| ------------ | ---------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| Phase 9 API  | 9.1 — engine + `POST /analytics/query` (2026-07-20)        | 9.2 saved views + query-builder UI            | `docs/phase-9-progress.md`                        |
| Phase 9 web  | nothing — no `analytics` route/lib/components exist yet    | 9.2/9.3; Recharts is **not** a dependency yet | `apps/web/package.json` (no `recharts`)           |
| Phase 10 API | 10.1 schema + `resolvePeriod`, 10.2 CRUD API               | 10.5 progress service + `GET /:id/progress`   | `docs/phase-10-progress.md`                       |
| Phase 10 web | 10.3 form dialogs, 10.4 `/budgets` list page (2026-07-20)  | 10.6 dashboard + `/budgets/[budgetId]` detail | `docs/phase-10-progress.md`                       |
| Worktrees    | `phase/9` — 2 unmerged doc commits, in-flight (2026-09-24) | `phase/10` — 0 commits ahead of `develop`     | `git -C ~/myfinpro-phase{9,10} log develop..HEAD` |

## Phase 9 — the aggregation engine

### Hybrid purchase-row grain

`purchaseRowsCte()` (`apps/api/src/analytics/engine/purchase-rows.sql.ts`) builds one
`WITH base … item_totals … purchase_rows` CTE whose last block is three `UNION ALL` arms:

| Arm           | When                                     | `amount_cents`              | Category                 | product / merchant             |
| ------------- | ---------------------------------------- | --------------------------- | ------------------------ | ------------------------------ |
| item rows     | txn has a `CONFIRMED` receipt with items | `receipt_items.total_cents` | `COALESCE(item, header)` | item product, receipt merchant |
| balancing row | that sum ≠ the header amount             | `header − Σ items`          | header                   | `NULL` / receipt merchant      |
| header row    | no confirmed receipt items               | `transactions.amount_cents` | header                   | `NULL` / receipt merchant      |

The balancing row absorbs receipt-level discounts and reconcile deltas, which is what makes the
invariant hold: **Σ(purchase rows) ≡ Σ(countable transaction amounts)** for any filter set that
does not touch item-only fields. Countable = `status='POSTED' AND type='ONE_TIME'`: recurring /
plan parents are templates, their `ONE_TIME` children count instead, and `PENDING` occurrences do
not count at all. Filtering by `productIds` deliberately selects item rows only, so totals then
mean "receipted purchases matching the filter".

### Dimensions, filters, metrics

Dimensions are a closed allowlist mapped to fixed SQL in `engine/dimension-sql.ts` — user input
selects a map entry, it never becomes SQL text. 0–2 dimensions per query (`ANALYTICS_MAX_DIMENSIONS`);
**currency is an implicit extra dimension on every row** (no FX anywhere), and the user's
`defaultCurrency` sorts first.

| Dimension              | Expression                       | Note                                                                        |
| ---------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `category`             | `p.category_id`                  | item category with header fallback, **primary only**                        |
| `merchant` / `product` | `p.merchant_id` / `p.product_id` | `NULL` id = the "no value" bucket                                           |
| `member`               | `p.created_by_id`                | "on behalf of" = the transaction creator                                    |
| `group` / `scope`      | `a.group_id` / `a.scope_type`    | forces attribution-join mode                                                |
| `period`               | `DATE_FORMAT(CONVERT_TZ(…))`     | `granularity` day/week/month/quarter/year, required iff `period` is present |

Filters (`AnalyticsFiltersDto`): `direction` (default `OUT`), `scopes`, `dateFrom`/`dateTo`,
`categoryIds`, `merchantIds`, `productIds`, `memberIds`, `currencies`; id lists capped at 100.
Metrics per row: `spendCents`, `transactionCount` (distinct txns), `itemCount` (item rows).

**Visibility** is one SQL helper, `engine/analytics-visibility.sql.ts`, mirroring
`TransactionService.buildVisibilityWhere`: personal attribution of the caller OR attribution to a
group the caller belongs to. Count-once vs fan-out is the key semantic:

- scope/group **filter** only narrows the `EXISTS` predicate → a transaction still counts once;
- scope/group **dimension** joins `transaction_attributions` → a dual-attributed transaction
  appears once per attribution, so cross-scope sums may legitimately exceed unique spend.

### Endpoint

**`POST /analytics/query`** (`JwtAuthGuard`, `@HttpCode(200)`) is the only analytics endpoint that
exists. It is a read despite the verb — the query object is too structured for a query string — and
never mutates state.

Errors (`analytics/constants/analytics-errors.ts`): `ANALYTICS_INVALID_QUERY` (400 — granularity ⇔
period mismatch, `scope`+`group` together, `dateFrom ≥ dateTo`, malformed scope entries, window past
the 500-group cap), `ANALYTICS_SCOPE_FORBIDDEN` (403 — scope filter names a non-member group),
`ANALYTICS_INVALID_CURSOR` (400).

Pagination is the standard `{ data, cursor, hasMore }` envelope, but the cursor is an **offset plus
a query fingerprint** (`{ o, f }`) because grouped rows have no stable id: `queryFingerprint()`
canonicalizes the query with `limit`/`cursor` stripped, so a cursor is valid only for the exact query
that produced it. Ordering is deterministic (sort key → default-currency-first → every dimension
alias → currency) so offset pages stay stable. Limits: `DEFAULT_LIMIT` 20, `MAX_LIMIT` 100,
`offset + limit ≤ ANALYTICS_MAX_GROUPS` (500).

### Shipped vs designed-not-built

Built: everything above, plus batch display-name resolution (a second `WHERE id IN (…)` query per
table, never a join into the aggregate). **Not built** (design §2.6–2.9, §5, §9):
`analytics_views` + saved-views CRUD and the query-builder UI (9.2), Recharts dashboards (9.3),
price dynamics `GET /analytics/products/:id/prices` (9.4), merchant rollups (9.5), group analytics
(9.6), `habit_summaries` + nightly `ANALYTICS_HABITS_QUEUE` + `GET /analytics/habits` (9.7 — **the
Phase 11 MCP dependency**), and the 9.8 p95 < 500 ms gate. No new indexes were added in 9.1 by
design; 9.8 decides from `EXPLAIN`.

## Phase 10 — budgets

### Shared period math

`packages/shared/src/budget-period.ts` — `resolvePeriod(period, refDate, timezone, { offset,
customStart, customEnd })` → `{ start, end, periodKey }`, half-open `[start, end)`, `periodKey` =
`yyyy-mm-dd` of the **local** period start. Dependency-free: timezone resolution uses only
`Intl.DateTimeFormat` (two-pass offset, cached per timezone); ISO weeks start Monday; skipped local
midnights fall forward; `offset` shifts to previous/next windows (for the planned `?periods=N`
history bars) and throws for `CUSTOM`, which passes the budget's explicit bounds through. Personal
budgets use `users.timezone`, group budgets the group creator's. The analytics engine reuses this
module's `tzOffsetMs` for period bucketing. `types/budget.types.ts` holds `BUDGET_PERIODS`,
`BUDGET_ALERT_KINDS` and the derived `BudgetProgress` shape.

### Schema (expand-only, migration `20260704180000_phase10_101_budgets`)

`Budget` — name, `amountCents`, `currency`, `scopeType` + exactly one of `ownerId`/`groupId`
(mirrors `transaction_attributions`), optional `categoryId` (`SetNull`), `period` + nullable
`startsAt`/`endsAt` for `CUSTOM`, `alertThresholdPct` (1–100, null = off) + `alertOverspend`,
`archivedAt` soft-archive; list indexes `(ownerId|groupId, scopeType, archivedAt)`.
`BudgetAlertEvent` — `kind`, nullable `budgetId`/`transactionId` (Cascade), `periodKey`, `details`
JSON. `users.due_reminder_days` defaults to 3 (0 disables). Progress is **never stored** — it is one
indexed aggregate over `transactions` per period.

### CRUD API (`apps/api/src/budget/`, iteration 10.2 — shipped)

| Method | Path                                 | Role                                                                 |
| ------ | ------------------------------------ | -------------------------------------------------------------------- |
| POST   | `/budgets`                           | personal: owner; group: ADMIN                                        |
| GET    | `/budgets`                           | cursor list, `?scope=all\|personal\|group:<id>`, `?includeArchived=` |
| GET    | `/budgets/:id`                       | owner / any group member                                             |
| PATCH  | `/budgets/:id`                       | owner / group ADMIN                                                  |
| DELETE | `/budgets/:id`                       | owner / group ADMIN — hard delete, alert events cascade              |
| POST   | `/budgets/:id/archive`, `/unarchive` | owner / group ADMIN; unarchive is idempotent                         |

Throttles: 30/min mutations, 120/min reads. Non-accessors get **404** (existence is never leaked);
the single deliberate **403** is a group member mutating a group budget (`BUDGET_FORBIDDEN`). Other
codes: `BUDGET_NOT_FOUND`, `BUDGET_INVALID_{SCOPE,PERIOD,CATEGORY}`, `BUDGET_ARCHIVED`. Currency
falls back to the owner's / group's `defaultCurrency` (`'USD'` if unset). Every mutation writes an
audit row (`BUDGET_CREATED/UPDATED/DELETED/ARCHIVED/UNARCHIVED`, failures logged not thrown) and
publishes the advisory SSE event `budget.updated` to the owner or all group members.

### Web (10.3–10.4 — shipped)

`apps/web/src/lib/budget/{budget-context.tsx,types.ts,remember.ts}` (provider mounted in the locale
layout; `AbortSignal` on every method; `errorCode`-carrying errors; last-used scope remembered),
`components/budget/{BudgetFormDialog,CreateBudgetDialog,BudgetCard}.tsx`, route
`app/[locale]/budgets/{page.tsx,budgets-client.tsx}`. The list follows the `/transactions` commit
pattern (controls bind to committed filters only, `<RetryReturnDialog>` on failure with a
newest-fetch guard) and refetches on `budget.updated`, resync-after-gap and locale flips. Scope is
immutable in edit mode; PATCH sends a minimal diff. `BudgetCard` has **no progress bar** — the slot
is reserved for 10.5/10.6 and nothing is faked.

### Not built yet

Progress service + `GET /budgets/:id/progress` (10.5), dashboard and detail page (10.6), group
budgets end-to-end (10.7–10.8), `BUDGET_ALERTS_QUEUE` + `dedup_key` migration + re-arm-on-edit +
`budget.alert` + `GET /budgets/alerts` (10.9), `TRANSACTION_DUE_QUEUE` + reminder settings (10.10).
No budget worker, queue constant or `budget.alert` event exists in the code today.

## Invariants and gotchas

- **Never break Σ(purchase rows) ≡ Σ(countable transactions).** Any new arm, join or filter in
  `purchase-rows.sql.ts` must preserve it; the integration spec asserts it directly.
- **`GROUP BY` / `ORDER BY` reference select aliases, never expressions.** The period expression
  binds a placeholder; repeating it in `GROUP BY` binds a _second_ one, which `ONLY_FULL_GROUP_BY`
  treats as a different, non-grouped expression (MySQL 1055).
- **Raw SQL lives only in `analytics/engine/`** — the first and only `$queryRaw` in the codebase.
  Everything binds through `Prisma.sql`; identifiers come from the enum maps.
- The `category` **dimension** is primary-only, but the `categoryIds` **filter** is any-match
  (effective category OR any `transaction_categories` row) — grouping by the many-to-many table
  would fan out rows and double-count `SUM()`. Multi-category transactions shipped 2026-07-24,
  after the Phase 9 design was written, so the design doc does not mention this.
- Period buckets use a **fixed per-query UTC offset**, not MySQL named timezones; queries spanning a
  DST change can mis-bucket edge hours (accepted v1 limit, design §10). An unknown stored timezone
  silently degrades to UTC.
- `BudgetAlertEvent`'s composite unique `(kind, budgetId, transactionId, periodKey)` **cannot dedup
  on MariaDB** — NULLs are distinct and every row has a NULL FK. It is still in the schema; 10.9
  replaces it with a required computed `dedup_key` while the table is empty.
- Only transactions in the budget's own currency count toward progress; the rest surface as
  `excludedOtherCurrencyCount`. A transaction attributed to both personal and a group counts toward
  both scopes' budgets.

## Drift from the design docs

- Phase 9 design §6 names the dimension file `dimensions.sql.ts`; the code has `dimension-sql.ts`.
- Phase 10 design §5 says `GET /budgets/:id` returns progress inline; `BudgetResponseDto` has none.
- `docs/progress.md` (2026-07-20) says Phase 10 is "10.1 shipped, budgets API in flight";
  `docs/phase-10-progress.md` and `git log` show 10.1–10.4 shipped.
- The 10.1 journal calls the dedup FK `paymentId`; the column is `transaction_id` (renamed in 8.20).

## Tests

API: `apps/api/src/analytics/engine/*.spec.ts` (fingerprint/offset, dimension map, engine validation
and mapping); `apps/api/test/integration/analytics-query.integration.spec.ts` (Σ invariant, every
dimension incl. balancing-row math, fan-out vs count-once, currency ordering, month bucketing,
cursor + fingerprint mismatch, 403 on non-member scope, template/`PENDING` exclusion);
`apps/api/src/budget/*.spec.ts` and `budgets-crud.integration.spec.ts` (scope matrix
owner/admin/member/outsider). Web: `BudgetFormDialog.spec.tsx`, `budgets-client.spec.tsx`, and the
live-stack `apps/web/e2e/budgets.spec.ts` (create → edit → archive → unarchive → delete).

## Deep dives

[phase-9-analytics-design.md](../docs/phase-9-analytics-design.md) §2.1 grain, §2.3 visibility, §2.5
dimensions, §2.7–2.9 unbuilt features, §5 endpoints, §9 iterations ·
[phase-10-budgets-design.md](../docs/phase-10-budgets-design.md) §2.2 progress, §2.5 alerts, §5 API
rules, §6 workers, §8 iterations · [phase-9-progress.md](../docs/phase-9-progress.md) ·
[phase-10-progress.md](../docs/phase-10-progress.md) · siblings [data-model.md](data-model.md), [roadmap.md](roadmap.md).
