# Phase 9: Purchase Analytics (Configurable) — Design Document

> Status: **approved design** (2026-07-17). Decisions taken with the product owner:
> **hybrid grain**, **Recharts**, **per-currency aggregation (no FX)**, **nightly habit job**.
>
> Implements [`IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md) Phase 9 (iterations 9.1–9.8).

## 1. Overview

Phase 9 delivers the **configurable analytics engine**: the user composes dimensions
(merchant / category / product / member / group / scope / period) and filter conditions,
runs the query, and can save named views. On top of the same engine sit prebuilt
dashboards (category pie, monthly trend, top merchants/products), per-product **price
dynamics**, per-merchant rollups, group member breakdowns, and persisted **habit
summaries** (consumed later by the Phase 11 MCP server).

### User stories covered (from [`SPECIFICATION-USER-STORIES.md`](../SPECIFICATION-USER-STORIES.md))

- View places/stores organized by categories and names (shopping patterns).
- View the list of goods purchased.
- Price dynamics for goods bought multiple times — in general or by store.
- Composable dimension/filter combinations, saved for reuse ("where do I / my groups
  buy, how much per category, item, or place").
- Group analytics with per-member breakdowns (web-app-user stories).
- Habit summaries: "what I buy weekly or monthly" (LLM-assisted-user story; the MCP
  transport itself is Phase 11).

### Explicitly deferred

- **FX conversion** — aggregates stay per-currency (existing `TotalsCard` precedent).
  A rates table + conversion toggle is a candidate future enhancement.
- **Category habit detection** — v1 detects habits per **product** only.
- **Shared/group-owned saved views** — views are private to their creator.
- **Materialized aggregates** — everything is computed on read with indexes; revisit
  only if the 9.8 performance gate fails.

## 2. Core Concepts

### 2.1 The purchase-row model (hybrid grain)

One engine, one virtual row set. Every **countable transaction** (§2.2) contributes
rows from exactly one of two sources, plus a balancing correction:

| Row source        | When                                        | Amount                         | Category                                | Product / merchant                             |
| ----------------- | ------------------------------------------- | ------------------------------ | --------------------------------------- | ---------------------------------------------- |
| **Item rows**     | txn's `CONFIRMED` receipt has ≥ 1 item      | `receipt_items.total_cents`    | `COALESCE(item.category, txn.category)` | `item.product_id`, `receipt.merchant_id`       |
| **Header row**    | no confirmed receipt items                  | `transactions.amount_cents`    | `txn.category`                          | product `NULL`; merchant via receipt if linked |
| **Balancing row** | receipted txn where Σ items ≠ header amount | `amount_cents − Σ item totals` | `txn.category`                          | product `NULL`; merchant from the receipt      |

The balancing row absorbs receipt-level discounts and attach-reconcile cases where
the user kept the transaction total. It guarantees the invariant that makes hybrid
trustworthy — and testable:

> **Σ(purchase rows) ≡ Σ(countable transaction amounts)** for any filter set that
> doesn't reference item-only dimensions.

Filters on item-only fields (product, item category) naturally select item rows only;
then totals are "receipted purchases matching the filter", which is what was asked.

### 2.2 Which transactions count

```
status = 'POSTED' AND type = 'ONE_TIME'
```

- `RECURRING` / `INSTALLMENT` / `LOAN` / `MORTGAGE` parents are **templates**
  ([`phase-6-transactions-design.md`](phase-6-transactions-design.md) §template);
  their generated occurrences are `ONE_TIME` children and are counted instead.
- Plan occurrences are pre-generated as `PENDING` and only count once `POSTED`.
- Direction is a filter (`OUT` default — this is _purchase_ analytics), but the
  engine accepts `IN` for income analytics at header grain (receipt items only
  exist for `OUT`) — same engine, zero extra code.
- Date basis for spend queries: `transactions.occurred_at` (the bookkeeping date).
  Price dynamics (§2.7) use `receipt_items.purchased_at` instead.

### 2.3 Visibility and scope semantics

The SQL predicate mirrors `TransactionService.buildVisibilityWhere` — a transaction
is visible iff it has a personal attribution for the caller **or** a group attribution
to a group the caller is a member of. The analytics module gets the same one-source-
of-truth treatment: a single `analytics-visibility.sql.ts` helper builds the
`EXISTS (…attribution…)` fragment used by every engine query.

**Counting semantics with multiple attributions** (a transaction can be attributed
personal + group simultaneously):

- When `scope` / `group` is **not** a dimension: each transaction counts **once**
  (plain `EXISTS`, no join fan-out). A narrowing scope **filter** only restricts
  the `EXISTS` predicate — a transaction attributed to two selected scopes still
  counts once, since no dimension separates the buckets.
- When `scope` or `group` **is** a dimension: the engine joins attributions, so a
  transaction appears once **per matching attribution** — consistent with how
  per-scope transaction lists behave today. The UI labels these views "by scope",
  where cross-scope sums may legitimately exceed unique spend; documented in the
  help text.

### 2.4 Currency

Currency is an **implicit dimension on every query**: rows never mix currencies,
no conversion happens anywhere. Responses order the user's `defaultCurrency` first,
then alphabetical (the `TotalsCard` convention). Charts render one series per
currency, with a currency selector when more than one is present.

### 2.5 Dimensions, filters, metrics

Dimensions are a **closed allowlist** (enum-validated DTO → fixed SQL expression
map — user input never reaches SQL as text):

| Dimension  | SQL expression (conceptually)             | Notes                                                  |
| ---------- | ----------------------------------------- | ------------------------------------------------------ |
| `category` | `COALESCE(ri.category_id, t.category_id)` | item category with header fallback (§2.1)              |
| `merchant` | `r.merchant_id`                           | `NULL` bucket = spend with no receipt/merchant         |
| `product`  | `ri.product_id`                           | `NULL` bucket = non-itemized spend                     |
| `member`   | `t.created_by_id`                         | "on behalf of" = creator (current product semantics)   |
| `group`    | attribution `group_id`                    | forces attribution-join mode (§2.3)                    |
| `scope`    | attribution `scope_type` (+ `group_id`)   | forces attribution-join mode (§2.3)                    |
| `period`   | bucketed `t.occurred_at`                  | granularity: `day \| week \| month \| quarter \| year` |

0–2 dimensions per query (charts and tables stay readable; the DTO enforces it).
Zero dimensions = grand totals per currency.

**Filters**: date range, direction, scope list (personal / specific groups),
category ids, merchant ids, product ids, member ids, currency list. All optional;
default = all accessible spend (`OUT`), all time.

**Metrics** (every response row): `spendCents` (sum), `transactionCount`
(distinct transactions), `itemCount` (item rows). Averages derive client-side.

**Sorting**: `spend` (default, desc) / `count` / dimension key. **Pagination**:
the standard `{ data, cursor, hasMore }` envelope; the cursor encodes the offset +
a query fingerprint (grouped rows have no stable id to key on). Page cap 100,
hard result cap 500 groups.

**Period bucketing and timezones**: buckets are computed in the user's IANA
timezone, applied as a per-query UTC offset (`CONVERT_TZ(t.occurred_at, '+00:00', ?)`
with the offset resolved in Node via `Intl`). Queries spanning a DST change can
mis-bucket edge hours — accepted v1 limitation (see §10); avoids depending on
MySQL named-timezone tables being loaded.

### 2.6 Saved views

A saved view = name + the exact query DTO as JSON, private to its creator.
Saving re-validates the JSON through the same DTO pipeline; loading a view whose
referenced entities (group, category…) are gone simply returns empty buckets —
views hold ids, not joins. Cap: 50 views per user (`ANALYTICS_MAX_VIEWS`).

### 2.7 Price dynamics

`GET /analytics/products/:productId/prices` returns a **unit-price series** from
confirmed, visible receipt items of that product:

- unit price = `unit_price_cents` when extracted, else `total_cents / quantity`;
- optional `merchantId` filter and `splitByMerchant` mode (one series per merchant);
- date basis `receipt_items.purchased_at` (falls back to the transaction date when
  the receipt had no purchase date); raw points up to 500, else daily-median buckets;
- per-currency series, like everything else.

Served by the `(product_id, purchased_at)` index put on `receipt_items` in Phase 8
precisely for this. UI: a "Price history" section on the product detail page
(overall line + per-merchant split toggle + date range), plus deep links from
analytics tables.

### 2.8 Merchant analytics

`GET /analytics/merchants` (+ `/:merchantId` detail) — canned compositions over the
same engine, not a parallel code path:

- totals + **visit count** (distinct receipted transactions) + **average basket**
  (total / visits) per merchant, per currency;
- detail adds category mix (top item-categories at that merchant) and a monthly
  trend.

### 2.9 Habit summaries

**What**: per (user, product) rows describing recurring purchases — cadence
(`WEEKLY` / `MONTHLY`), typical quantity and spend, dominant merchant.

**Detection algorithm** (v1, pure function, exhaustively unit-tested; all thresholds
are named constants in `packages/shared`):

1. Input: the user's **visible** confirmed receipt items with a `product_id`,
   last 180 days (`HABIT_WINDOW_DAYS`), collapsed to one observation per
   (product, calendar day) — quantities and spend summed per day.
2. Products with ≥ 3 observations (`HABIT_MIN_OCCURRENCES`) qualify.
3. Median inter-observation interval `d` (computed in Node — MySQL 8 has no
   `PERCENTILE_CONT`): `3 ≤ d ≤ 11` → `WEEKLY`; `20 ≤ d ≤ 45` → `MONTHLY`;
   anything else → no habit.
4. Typical quantity / spend = medians of the daily observations; currency and
   merchant = most frequent (ties → most recent); multi-currency products keep
   the dominant currency only.

**Refresh**: nightly BullMQ job scheduler (`upsertJobScheduler`, cron `0 3 * * *`,
`ANALYTICS_HABITS_QUEUE`) — recomputes users who have receipt activity since the
previous run (receipts `CONFIRMED` with `updated_at` in the last 26 h), replacing
each user's rows atomically (delete-then-insert in one transaction). Summaries are
at most ~24 h stale, which is fine for advice-grade data. `GET /analytics/habits`
serves the current user; Phase 11 MCP reads the same service.

## 3. Database Schema

Two expand-only migrations (9.2 and 9.7). No changes to existing tables — the
engine reads what Phases 6–8 already indexed.

```prisma
// ── Phase 9: Purchase Analytics ──

// A saved analytics query — name + the query DTO as validated JSON.
// Private to its creator (design §2.6).
model AnalyticsView {
  id     String @id @default(uuid()) @db.VarChar(36)
  userId String @map("user_id") @db.VarChar(36)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  name   String @db.VarChar(100)
  query  Json

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([userId, name])
  @@map("analytics_views")
}

// Persisted recurring-purchase detection result (design §2.9). Rebuilt
// nightly per active user; read by the web UI and (Phase 11) MCP tools.
model HabitSummary {
  id        String  @id @default(uuid()) @db.VarChar(36)
  userId    String  @map("user_id") @db.VarChar(36)
  user      User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  productId String  @map("product_id") @db.VarChar(36)
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  // WEEKLY | MONTHLY
  cadence           String  @db.VarChar(10)
  // Median inter-purchase interval, days.
  intervalDays      Decimal @map("interval_days") @db.Decimal(6, 2)
  typicalQuantity   Decimal @map("typical_quantity") @db.Decimal(10, 3)
  typicalSpendCents Int     @map("typical_spend_cents")
  currency          String  @db.VarChar(3)
  // Dominant merchant across the window; SetNull keeps the habit if the
  // merchant row is ever merged/removed.
  merchantId String?   @map("merchant_id") @db.VarChar(36)
  merchant   Merchant? @relation(fields: [merchantId], references: [id], onDelete: SetNull)

  occurrenceCount   Int      @map("occurrence_count")
  firstPurchasedAt  DateTime @map("first_purchased_at")
  lastPurchasedAt   DateTime @map("last_purchased_at")
  computedAt        DateTime @map("computed_at")

  @@unique([userId, productId])
  @@index([userId, cadence])
  @@map("habit_summaries")
}
```

### Index analysis (cross-cutting rule §3.3)

Existing indexes already serve the engine's hot paths:

- `transactions (direction, occurred_at)`, `(type, status)`, `(created_by_id, occurred_at)`;
- `transaction_attributions (user_id, scope_type)`, `(group_id, scope_type)`, `(transaction_id)`;
- `receipt_items (product_id, purchased_at)` (built for §2.7), `(category_id)`,
  unique `(receipt_id, position)`;
- `receipts (transaction_id)` unique, `(merchant_id)`.

**No speculative new indexes in 9.1.** Iteration 9.8 runs `EXPLAIN` over the
production-size fixture set and adds indexes only where measurements demand
(candidate: `transactions (status, type, occurred_at)` if the direction index
proves insufficient).

## 4. Shared Types (`packages/shared`)

New `types/analytics.types.ts` (+ constants), mirroring transaction-type conventions:

```ts
export const ANALYTICS_DIMENSIONS = [
  'category',
  'merchant',
  'product',
  'member',
  'group',
  'scope',
  'period',
] as const;
export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number];

export const ANALYTICS_GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type AnalyticsGranularity = (typeof ANALYTICS_GRANULARITIES)[number];

export const ANALYTICS_SORTS = ['spend', 'count', 'key'] as const;

export const HABIT_CADENCES = ['WEEKLY', 'MONTHLY'] as const;
export type HabitCadence = (typeof HABIT_CADENCES)[number];

export const HABIT_WINDOW_DAYS = 180;
export const HABIT_MIN_OCCURRENCES = 3;
export const ANALYTICS_MAX_VIEWS = 50;
export const ANALYTICS_MAX_GROUPS = 500;

export interface AnalyticsQuery {
  dimensions: AnalyticsDimension[]; // 0..2
  granularity?: AnalyticsGranularity; // required iff 'period' is a dimension
  filters?: {
    direction?: TransactionDirection; // default 'OUT'
    scopes?: AttributionScope[]; // default: everything accessible
    dateFrom?: string;
    dateTo?: string; // ISO 8601
    categoryIds?: string[];
    merchantIds?: string[];
    productIds?: string[];
    memberIds?: string[];
    currencies?: string[];
  };
  sort?: { by: (typeof ANALYTICS_SORTS)[number]; dir: 'asc' | 'desc' };
  limit?: number;
  cursor?: string;
}

export interface AnalyticsKeyRef {
  id: string | null;
  name: string | null;
}

export interface AnalyticsResultRow {
  keys: Partial<Record<Exclude<AnalyticsDimension, 'period' | 'scope'>, AnalyticsKeyRef>> & {
    period?: string; // '2026-06' | '2026-06-15' | '2026-W24' | '2026-Q2' | '2026'
    scope?: { scopeType: AttributionScopeType; group?: AnalyticsKeyRef };
  };
  currency: string;
  spendCents: number;
  transactionCount: number;
  itemCount: number;
}
```

Plus `AnalyticsViewSummary`, `PricePoint` / `PriceSeries`, `MerchantStatsRow`,
`HabitSummaryRow` response shapes (defined alongside; omitted here for brevity).

## 5. API Design

All endpoints live in a new `AnalyticsModule` (`apps/api/src/analytics/`),
JWT-guarded, Swagger-documented, standard error envelope.

| Method | Endpoint                                | Iter | Description                                                      |
| ------ | --------------------------------------- | ---- | ---------------------------------------------------------------- |
| POST   | `/analytics/query`                      | 9.1  | Run a configurable aggregation (body = `AnalyticsQuery`)         |
| GET    | `/analytics/views`                      | 9.2  | List my saved views                                              |
| POST   | `/analytics/views`                      | 9.2  | Create (name + query; 409 on duplicate name; 400 over cap)       |
| PATCH  | `/analytics/views/:id`                  | 9.2  | Rename / replace query (owner only)                              |
| DELETE | `/analytics/views/:id`                  | 9.2  | Delete (owner only)                                              |
| GET    | `/analytics/products/:productId/prices` | 9.4  | Price series (`merchantId?`, `splitByMerchant?`, `from?`, `to?`) |
| GET    | `/analytics/merchants`                  | 9.5  | Merchant rollups (totals, visits, avg basket) + pagination       |
| GET    | `/analytics/merchants/:merchantId`      | 9.5  | One merchant: rollup + category mix + monthly trend              |
| GET    | `/analytics/habits`                     | 9.7  | Current user's habit summaries                                   |

`POST /analytics/query` is a **read** despite the verb — the query object is too
structured for query strings. It is rate-limited with the global throttler profile
and never mutates state.

## 6. Engine Implementation Notes

- First `$queryRaw` usage in the codebase — isolated in **one** module:
  `analytics/engine/` with `purchase-rows.sql.ts` (the three-arm `UNION ALL` CTE
  from §2.1), `dimensions.sql.ts` (the allowlist expression map), and
  `analytics-engine.service.ts` (composition, parameter binding, row mapping).
  Everything is bound via placeholders (`Prisma.sql` template composition);
  dimension/sort identifiers come from the enum maps, never from input strings.
- Key-name resolution (category/merchant/product/member/group names) happens in a
  **second cheap query** per referenced table (`WHERE id IN (…page ids…)`), not by
  joining names into the aggregate — keeps the aggregate narrow and the row mapper
  trivial.
- Deterministic ordering: sort key + dimension key(s) + currency as tiebreakers,
  so offset-cursor pages are stable for a fixed dataset.
- The engine service exposes a typed `runQuery(userId, AnalyticsQuery)` consumed by
  the controller, merchant/price/habit services, **and** (Phase 11) MCP tools.

## 7. Workers (BullMQ)

### 7.1 `ANALYTICS_HABITS_QUEUE` — nightly repeatable job

- `upsertJobScheduler('analytics-habits-nightly', { pattern: '0 3 * * *' }, …)` —
  same pattern as the transaction-occurrence and budget-alert schedulers.
- Job: select users with receipt activity in the last 26 h (§2.9) → for each, load
  window rows, run the pure detector, replace `habit_summaries` rows in one DB
  transaction. Per-user try/catch: one failing user never aborts the sweep
  (mirrors the occurrence worker's error isolation).
- Idempotent and re-runnable; a manual trigger exists via a protected admin-less
  path: re-running the job simply recomputes the same rows.

## 8. Frontend Design

### Routes

| Route                       | Iter    | Content                                                                                        |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `/analytics`                | 9.2/9.3 | Tabs: **Dashboard** (canned widgets + habits card) / **Explore** (query builder + saved views) |
| `/analytics/merchants`      | 9.5     | Merchant rollup table                                                                          |
| `/analytics/merchants/[id]` | 9.5     | Merchant detail: totals, category mix, trend                                                   |
| `/products/[id]`            | 9.4     | gains a "Price history" section                                                                |
| `/groups/[groupId]`         | 9.6     | gains an **Analytics** tab (member breakdown + category drilldown)                             |

Header nav gains an "Analytics" link (next to Transactions). All strings via
next-intl EN + HE from day one; charts stay LTR in RTL locales (standard practice)
with localized labels/legends/numbers; dark mode via theme tokens.

### Components (`apps/web/src/components/analytics/`)

- `QueryBuilder` — dimension pickers (max 2), granularity select, filter chips
  (reusing the transactions filter-bar patterns), run button via `useAsyncOperation()`.
- `SavedViewsMenu` — load/save/rename/delete.
- `ResultTable` — grouped rows, per-currency sections, CSV-free v1.
- `charts/` — thin themed wrappers over **Recharts** (dynamic-imported so the
  library only loads on analytics routes): `CategoryPie`, `TrendLine`, `TopBar`,
  `PriceLine`. One shared `chartTheme.ts` maps Tailwind CSS variables → chart
  colors so light/dark/RTL stay consistent.
- `HabitsCard`, `MemberBreakdown` (9.6, reused by the group tab).

### Dashboard widgets (9.3) — all canned `AnalyticsQuery` presets

Category pie (this month), 12-month trend line, top-5 merchants, top-5 products.
**DRY win**: the dashboard `TotalsCard` (currently client-side over a capped 100-row
page, with a "partial totals" badge) switches to one engine query — the badge and
the cap die.

## 9. Iteration Plan (9.1 – 9.8)

Each iteration is deployable, prettier-formatted, staging-verified (manual check
requested after each staging deploy), and follows the plan's CI/CD columns.

| Iter | Ships                                                                                                                                                                                                                                      | Tests                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 9.1  | Shared analytics types; `AnalyticsModule`; engine (purchase rows + dimension map + visibility fragment); `POST /analytics/query` with pagination + Swagger                                                                                 | Engine unit tests; integration tests on seeded fixtures incl. the Σ-invariant, multi-currency, scope fan-out semantics  |
| 9.2  | `analytics_views` migration; views CRUD API; `/analytics` page with Explore tab: QueryBuilder, ResultTable, SavedViewsMenu                                                                                                                 | API integration (cap, dup-name, owner guard); component tests for builder round-trip (query → UI → query)               |
| 9.3  | Recharts (code-split) + chart theme; Dashboard tab widgets; chart toggle in Explore; `TotalsCard` switched to the engine                                                                                                                   | Chart component tests (render, currency split, empty states); dashboard smoke                                           |
| 9.4  | Price series endpoint; product-page Price history section (overall/per-merchant, range selector)                                                                                                                                           | API integration (unit-price fallback, merchant split, visibility); UI tests                                             |
| 9.5  | Merchant rollup + detail endpoints; `/analytics/merchants` pages                                                                                                                                                                           | API integration (visit counts, avg basket, category mix); UI tests                                                      |
| 9.6  | Group Analytics tab: member breakdown + per-member category drilldown (engine queries with `member` dimension + group scope filter)                                                                                                        | Integration (member percentages vs fixtures); UI tests                                                                  |
| 9.7  | `habit_summaries` migration; pure detector; nightly worker; `GET /analytics/habits`; Dashboard habits card                                                                                                                                 | Detector unit matrix (cadence bands, medians, dominance rules); worker integration (replace-atomicity, error isolation) |
| 9.8  | Production-size fixture seeding; `EXPLAIN`/p95 pass (< 500 ms gate) + any measured indexes; Playwright E2E (build → save → reload view; dashboard); visual regression baselines; i18n EN+HE sweep; dark-mode pass; docs + progress records | Full suite green; visual baselines committed                                                                            |

## 10. Risks & Open Questions

| Risk                                                               | Mitigation                                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| First raw SQL in the repo — regression surface                     | One isolated engine module; parameter binding only; the 9.1 fixture matrix is the spec        |
| DST edge mis-bucketing with fixed per-query UTC offset (§2.5)      | Accepted v1; revisit with MySQL tz tables or day-level pre-bucketing if users report issues   |
| Scope-dimension fan-out surprises users (sums exceed unique spend) | Semantics documented in UI help text; default queries use `EXISTS` (count-once) mode          |
| Recharts bundle weight                                             | `next/dynamic` import on analytics routes only                                                |
| Habit detector tuning (bands too strict/loose)                     | Thresholds are shared constants; detector is pure → cheap to re-tune with tests               |
| Aggregation cost growth over time                                  | 9.8 gate on production-size fixtures; materialized rollups remain the documented escape hatch |
