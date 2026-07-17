# Phase 10: Budgets & Spending Targets — Design Document

> **Status**: In progress — 10.1–10.2 shipped; design revised 2026-07-17
> (event-driven alerts, alert re-arm on edit, dedup-key fix, low-balance
> deferral — decisions recorded in §2.5, §3, §9)
> **Plan**: [`IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md) §5 — Phase 10 (renumbered from the original Phase 8 in the 2026-07-03 re-plan)
> **Depends on**: Phase 6 (Transaction entity, attributions, categories, BullMQ, realtime SSE stack), Phase 4 (mail infrastructure for alerts), Phase 5 (groups, roles)
> **Independent of**: Phases 7–9 — budgets only need transactions, so this phase can run in parallel with the receipt/product/analytics track
> **Feeds**: Phase 11 (MCP budget/target tools), Phase 12.9 (Telegram due-transaction / low-balance alerts), Phase 13.8 (mini-app budget view), Phase 16 (LLM assistant context)

## 1. Overview

Users create **budgets** (spending targets): a named amount for a timeframe,
scoped to themselves or to one of their groups, optionally narrowed to a
category. The system tracks progress against actual Phase-6 transactions
(direction `OUT`), shows progress bars on personal and group dashboards,
and raises **alerts** when a configurable threshold is crossed. A second
deliverable is **due-transaction reminders** built on the existing
`transaction_schedules` / `transaction_plans` data.

### User stories covered (from [`SPECIFICATION-USER-STORIES.md`](../SPECIFICATION-USER-STORIES.md))

- As a personal user, I can create spending targets with a name, amount, and timeframe, and track progress.
- As a personal user, I can create a dashboard for myself and see monthly income, spending, and targets progress.
- As a personal user, I can set reminders for due transactions and low balance alerts.
- As a group owner, I can assign budgets and targets scoped to the group and track progress.
- As a web app user, I can set up notifications (email now; Telegram/web-push later) about due transactions, low balances, and target progress that is low or has gone backwards.

### Explicitly deferred

| Concern                                       | Where                                                                                                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram notification channel                 | Phase 12.9 (consumes the same alert events)                                                                                                                                                                     |
| Web-push notification channel                 | Post-Phase 13 (needs service worker)                                                                                                                                                                            |
| Budget analytics over receipt items/products  | Phase 9 (item-level analytics)                                                                                                                                                                                  |
| MCP add/remove budgets & targets tools        | Phase 11.4                                                                                                                                                                                                      |
| Mini-app budget view                          | Phase 13.8                                                                                                                                                                                                      |
| Rollover budgets (unused amount carries over) | Out of scope — periods are independent                                                                                                                                                                          |
| Income targets (direction `IN`)               | Out of scope — budgets track spending (`OUT`)                                                                                                                                                                   |
| Multi-currency conversion inside one budget   | Out of scope — a budget counts only transactions in its own currency (see §2.4)                                                                                                                                 |
| Low-balance warnings                          | Deferred (2026-07-17 decision) — "balance" needs an account/balance concept the system doesn't have yet; revisit alongside Phase 12.9 bot alerts. Phase 10 ships budget alerts + due-transaction reminders only |

## 2. Core Concepts

### 2.1 Budget = scoped target + recurrence of periods

A `Budget` is a **standing definition**: name, `amountCents`, `currency`,
scope (`personal` for the owner, or `group:<id>`), optional `categoryId`
filter, and a `period` (`WEEKLY | MONTHLY | QUARTERLY | YEARLY | CUSTOM`).
Periods repeat automatically: a `MONTHLY` groceries budget applies to every
calendar month with no user action. `CUSTOM` uses explicit
`startsAt`/`endsAt` and does not repeat (a one-off target, e.g. "Vacation
2026 — ₪8,000").

Calendar boundaries are computed in the **user's timezone** (`users.timezone`,
Phase 4.7.2) for personal budgets and the **group creator's timezone** for
group budgets — cheap, deterministic, revisit if it ever matters. Weeks
start Monday (ISO 8601).

### 2.2 Progress is derived, never stored

`spentCents` for a period is computed on read from `transactions`:

```
Σ transactions.amount_cents
WHERE direction = 'OUT'
  AND status = 'POSTED'
  AND occurred_at ∈ [periodStart, periodEnd)
  AND currency = budget.currency
  AND (budget.category_id IS NULL OR transactions.category_id = budget.category_id)
  AND transaction is attributed to the budget's scope
```

Scope attribution reuses the Phase-6 visibility rules:

- **personal budget** → transactions having a `transaction_attributions` row with
  `scope_type='personal' AND user_id = budget.owner_id`;
- **group budget** → transactions having a row with `scope_type='group' AND group_id = budget.group_id`.

A transaction attributed to both personal and a group counts toward both
scopes' budgets — same double-entry semantics the transaction list already has.
No materialized progress table: volumes are personal-finance-sized, the
query is a single indexed aggregate, and correctness-on-edit (transaction
edits/deletes/backdating) comes for free. The existing composite indexes
(`transaction_attributions (user_id, scope_type)` / `(group_id, scope_type)`,
`transactions (direction, occurred_at)`, `transactions (category_id)`) already
serve this aggregate; no new transaction-side indexes are expected (verified
with `EXPLAIN` in 10.5).

### 2.3 Roles & access

| Action                                    | Personal budget | Group budget                   |
| ----------------------------------------- | --------------- | ------------------------------ |
| Create / edit / delete / configure alerts | owner           | group **admin** (Phase 5 role) |
| View + progress                           | owner           | any group **member**           |

Mirrors the Phase 5/6 guard pattern (`GroupRolesGuard`-style checks in the
service layer). Non-accessors get 404, not 403 (same as transactions).

### 2.4 Currency

A budget has exactly one ISO 4217 currency (defaults to the user's /
group's `defaultCurrency`). Only transactions in **that same currency** count
toward progress; mixed-currency conversion is a deliberate non-goal until
an FX-rate source exists (post-Phase 9 decision). The progress API response
carries `excludedOtherCurrencyCount` so the UI can hint "3 transactions in
other currencies were not counted".

### 2.5 Alerts — evaluated by worker, delivered via events + email

Each budget has optional alert configuration: `alertThresholdPct`
(e.g. 80 — warn at 80% consumed) and `alertOverspend` (fire at ≥100%).
Evaluation is **event-driven with an hourly backstop** (2026-07-17
decision — an alert should land seconds after the expense, not up to an
hour later):

- **Event-driven**: every transaction create/edit/delete already publishes
  a `transaction.*` event on the in-process EventBus; the budget module
  listens and enqueues a debounced `BUDGET_ALERTS_QUEUE` job scoped to the
  affected budgets (the transaction's personal/group attributions ×
  currency × category). Deterministic job ids collapse bursts.
- **Hourly backstop**: the repeatable sweep (same cadence as the Phase-6
  occurrence worker) evaluates all active budgets — it catches backdated
  edits from other code paths, missed events, and restarts. Both paths
  run the same evaluator and are idempotent via the dedup key.

The evaluator emits:

- `budget.threshold` — consumed ≥ threshold, once per budget-period
  (dedup via `budget_alert_events` unique dedup key);
- `budget.overspent` — consumed ≥ 100%, once per budget-period.

**Re-arm on material edit** (2026-07-17 decision): editing a budget's
`amountCents`, `currency`, `categoryId`, `period`/bounds, or
`alertThresholdPct` deletes the current period's fired budget-alert rows,
so alerts re-arm against the new definition (raise groceries ₪2,000 →
₪3,000 after an 80% alert and the 80%-of-new-amount alert can fire again
this period). Non-material edits (name, `alertOverspend` toggle, archive
state) do not re-arm.

Delivery: an in-app **realtime SSE event** (`budget.alert`) plus an
**email** through the Phase 4 mail service. Recipients: the owner for
personal budgets; all group members for group budgets. The
`budget_alert_events` table is both the dedup guard and the "notification
history" the Phase 12 bot will later read.

**Due-transaction reminders** (10.10) follow the same pattern: a daily job
finds upcoming occurrences — `transaction_schedules.next_run_at` and
`PENDING` plan children `occurred_at` within the user's reminder window
(default 3 days) — and emits `transaction.due` events + emails, deduped per
(transaction, dueDate) in the same events table (`kind='TRANSACTION_DUE'`).

### 2.6 Realtime

New SSE event types published on the existing EventBus
(per [`docs/ui-realtime-conventions.md`](ui-realtime-conventions.md) —
advisory events + refetch on `resyncToken`):

| Event            | Fired on                                      | Recipients             |
| ---------------- | --------------------------------------------- | ---------------------- |
| `budget.updated` | budget create / edit / delete                 | owner or group members |
| `budget.alert`   | threshold / overspend / due-transaction event | owner or group members |

Progress itself is **not** streamed — dashboards refetch progress when a
`transaction.*` or `budget.*` event arrives for a relevant scope (the
dashboard already refetches on transaction events, so budget progress rides
the same trigger).

## 3. Database Schema

Expand-only migration; no changes to existing tables.

```prisma
// ── Phase 10: Budgets & Spending Targets ──

model Budget {
  id         String  @id @default(uuid()) @db.VarChar(36)
  name       String  @db.VarChar(100)
  amountCents Int    @map("amount_cents")
  currency   String  @db.VarChar(3)

  // Scope: exactly one of (ownerId) / (groupId) is set, mirroring
  // transaction_attributions. scopeType ∈ 'personal' | 'group'.
  scopeType  String  @map("scope_type") @db.VarChar(10)
  ownerId    String? @map("owner_id") @db.VarChar(36)   // Cascade on user delete
  groupId    String? @map("group_id") @db.VarChar(36)   // Cascade on group delete

  // Optional narrowing to one category (direction OUT); SetNull on
  // category delete so category cleanup never breaks budgets.
  categoryId String? @map("category_id") @db.VarChar(36)

  // Period: WEEKLY | MONTHLY | QUARTERLY | YEARLY | CUSTOM
  period     String  @db.VarChar(10)
  // CUSTOM only; both NULL for repeating periods.
  startsAt   DateTime? @map("starts_at")
  endsAt     DateTime? @map("ends_at")

  // Alerts (§2.5). NULL threshold = no threshold alert.
  alertThresholdPct Int?    @map("alert_threshold_pct")   // 1..100
  alertOverspend    Boolean @default(true) @map("alert_overspend")

  // Soft-archive: archived budgets keep history but stop being evaluated,
  // listed only with ?includeArchived=true.
  archivedAt DateTime? @map("archived_at")

  createdById String  @map("created_by_id") @db.VarChar(36)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  alertEvents BudgetAlertEvent[]

  @@index([ownerId, scopeType, archivedAt])
  @@index([groupId, scopeType, archivedAt])
  @@index([categoryId])
  @@map("budgets")
}

// Dedup + history for emitted alerts (§2.5). One row per unique alert.
model BudgetAlertEvent {
  id          String   @id @default(uuid()) @db.VarChar(36)
  // BUDGET_THRESHOLD | BUDGET_OVERSPENT | TRANSACTION_DUE
  kind        String   @db.VarChar(24)
  budgetId    String?  @map("budget_id") @db.VarChar(36)  // Cascade; NULL for TRANSACTION_DUE
  transactionId   String?  @map("transaction_id") @db.VarChar(36) // Cascade; NULL for budget kinds
  // Period/date key the dedup is scoped to:
  //   budget kinds  → period start date (yyyy-mm-dd)
  //   TRANSACTION_DUE   → due date (yyyy-mm-dd)
  periodKey   String   @map("period_key") @db.VarChar(10)
  // The actual dedup guard: `${kind}:${budgetId ?? ''}:${transactionId ?? ''}:${periodKey}`,
  // computed in the service. A composite unique over the nullable FK columns
  // does NOT work — MariaDB treats NULLs as distinct in unique indexes, and
  // every row has one of the two FKs NULL, so it would never fire (found
  // 2026-07-17; replaces the 10.1 composite unique in a 10.9 migration).
  dedupKey    String   @unique @map("dedup_key") @db.VarChar(110)
  // Snapshot for history/emails (spentCents, pct, dueAt, …).
  details     Json?
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([budgetId, createdAt])
  @@map("budget_alert_events")
}
```

**User reminder preference** (10.10): `users.due_reminder_days Int @default(3)`
— a single expand-only column on `users` (0 disables due reminders),
editable from Account Settings alongside currency/timezone. No separate
preferences table until there is a second notification preference
(dna.md: minimal).

**Indexes rationale**: budget lists are always fetched per scope
(`ownerId`/`groupId` + `scopeType`, filtered on `archivedAt IS NULL`);
alert history is read per budget ordered by time; the `dedup_key` unique
makes both evaluation paths idempotent under re-fires — the same trick as
`transactions.idempotency_key`.

## 4. Shared Types (`packages/shared`)

```ts
export const BUDGET_PERIODS = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const BUDGET_ALERT_KINDS = [
  'BUDGET_THRESHOLD',
  'BUDGET_OVERSPENT',
  'TRANSACTION_DUE',
] as const;
export type BudgetAlertKind = (typeof BUDGET_ALERT_KINDS)[number];

export interface BudgetProgress {
  budgetId: string;
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601 (exclusive)
  amountCents: number;
  spentCents: number;
  remainingCents: number; // amount − spent, may be negative
  pct: number; // 0..∞, rounded to 1 decimal
  excludedOtherCurrencyCount: number; // §2.4
}
```

Plus `budget-period.ts` — the **pure period-boundary calculator**
`resolvePeriod(period, refDate, timezone): { start, end }` (ISO weeks,
calendar months/quarters/years, custom passthrough). It lives in
`packages/shared` so the API worker, the web UI (e.g. "resets in 12 days"
labels), and later the bot all use the same math. Exhaustive unit tests
including DST transitions and the Asia/Jerusalem timezone.

## 5. API Design

All under `/api/v1`, JWT-guarded, throttled. Standard cursor pagination
DTOs from `packages/shared`.

| Method | Endpoint                | Purpose                                                                                    |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------ |
| POST   | `/budgets`              | create (validates scope membership/role, category direction, currency)                     |
| GET    | `/budgets`              | cursor list; filters `?scope=personal\|group:<id>\|all`, `?includeArchived=`               |
| GET    | `/budgets/:id`          | one budget (+ current-period progress inline)                                              |
| PATCH  | `/budgets/:id`          | edit name/amount/category/period/alert config (owner / group admin)                        |
| DELETE | `/budgets/:id`          | hard delete (alert events cascade)                                                         |
| POST   | `/budgets/:id/archive`  | soft-archive; `POST /budgets/:id/unarchive` reverses                                       |
| GET    | `/budgets/:id/progress` | progress for current period; `?periods=6` returns the last N period windows (history bars) |
| GET    | `/budgets/alerts`       | cursor list of the caller's alert history (dashboard bell + bot later)                     |

**Validation rules**

- `scopeType='personal'` → `ownerId = caller`; `scopeType='group'` →
  caller must be an **admin** of `groupId` (create/edit/delete) or a
  member (read). Non-member → 404.
- `categoryId`, when set, must be visible to the scope and direction
  `OUT` (or `BOTH`) — same check the transaction create endpoint runs.
- `period='CUSTOM'` requires `startsAt < endsAt`; other periods forbid them.
- `amountCents > 0`; `alertThresholdPct ∈ [1, 100] | null`; currency from
  the shared ISO list.

**Error codes** (`BUDGET_*`): `BUDGET_NOT_FOUND`, `BUDGET_INVALID_SCOPE`,
`BUDGET_INVALID_PERIOD`, `BUDGET_INVALID_CATEGORY`, `BUDGET_ARCHIVED`
(mutations on archived budgets), `BUDGET_FORBIDDEN` (member editing a
group budget — the one place we 403 because the resource is deliberately
visible).

**Audit actions**: `BUDGET_CREATED`, `BUDGET_UPDATED`, `BUDGET_DELETED`,
`BUDGET_ARCHIVED`, `BUDGET_UNARCHIVED`, `BUDGET_ALERT_SENT` (worker),
`TRANSACTION_DUE_REMINDER_SENT` (worker) — extending the Phase 6 audit matrix.

## 6. Workers (BullMQ)

### 6.1 `BUDGET_ALERTS_QUEUE` — event-driven + hourly backstop

Two producers, one evaluator (§2.5):

- **Targeted jobs** — a `transaction.*` EventBus listener enqueues an
  evaluation job for just the budgets matching the transaction's
  attributions (deterministic job id per budget-period debounces bursts).
- **Hourly sweep** — repeatable job evaluating all active budgets.

Evaluator steps:

1. Load the targeted (or all active, for the sweep) non-archived budgets
   with alert config in batches.
2. For each: `resolvePeriod(...)` → compute `spentCents` (one aggregate
   query per budget; batched with `Promise.all` chunks of 10).
3. Threshold crossed / overspent → `INSERT ... budget_alert_events`
   guarded by the `dedup_key` unique; on success (i.e. first time this
   budget-period), publish `budget.alert` SSE + send email (mail failures
   are logged, never crash the job — Phase 4 mail conventions), audit
   `BUDGET_ALERT_SENT`.
4. Re-fires and restarts are no-ops thanks to the dedup key; material
   budget edits delete the current period's rows so alerts re-arm (§2.5).

### 6.2 `TRANSACTION_DUE_QUEUE` — daily repeatable job (10.10)

1. Window = `[now, now + user.due_reminder_days]` per user (skip users
   with `0`).
2. Sources: `transaction_schedules.next_run_at` (active schedules) and plan
   child occurrences (`status='PENDING'`, `occurred_at` in window).
3. Same dedup-insert → SSE `budget.alert` (kind `TRANSACTION_DUE`) + email;
   audit `TRANSACTION_DUE_REMINDER_SENT`.

Both jobs follow the Phase-6 worker pattern
([`transaction-occurrence.processor.ts`](../apps/api/src/transaction/transaction-occurrence.processor.ts)):
repeatable job registered at module bootstrap, deterministic job ids,
processor unit-tested with a mocked queue + integration-tested via
Testcontainers.

## 7. Frontend Design

- **`/budgets`** — list page: cards per budget (name, scope chip, category
  chip, period label, progress bar with spent/remaining/pct, overspend in
  red), filter by scope, "archived" toggle. `CreateBudgetDialog` +
  `BudgetFormDialog` (shared create/edit form — DRY like
  `TransactionFormDialog`): name, amount + currency, scope select (reusing the
  transaction form's scope selector + `remember.ts`), optional category picker
  (OUT categories for the chosen scope), period select with custom date
  range disclosure, alert threshold slider.
- **`/budgets/[budgetId]`** — detail: current-period progress ring,
  last-6-periods history bars (`?periods=6`), the transactions that count
  toward the current period (reusing `<TransactionsList>` with pinned
  filters), alert history section, edit/archive/delete actions.
- **Dashboard** (`/dashboard`) — "Budgets" section: top budgets by
  consumed-pct with compact progress bars, linking to `/budgets`. Group
  dashboards (`/groups/[groupId]`) gain a Budgets tab listing that group's
  budgets with per-member contribution split (member share of the period's
  counted transactions — computed in the progress endpoint via
  `?breakdown=member`, keyed on `transactions.created_by_id`: there is no
  "on behalf of" field yet, so the creator is the member a transaction
  counts toward; revisit if/when on-behalf-of attribution lands).
- **Account Settings** — due-reminder window field (days, 0 = off).
- All UI async flows via `useAsyncOperation()`
  ([`docs/ui-async-conventions.md`](ui-async-conventions.md)); realtime
  refetch via the existing SSE subscription hooks; i18n namespace
  `budgets.*` in EN + HE from the start; dark-mode variants everywhere
  (Phase 6 conventions).

## 8. Iteration Plan (10.1 – 10.10)

Matches the [`IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md) Phase 10
table, with concrete deltas:

| It.     | Scope (delta)                                                                                                                                                                                                                | Tests                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 10.1 ✅ | `packages/shared`: `BUDGET_PERIODS`, `BudgetAlertKind`, `BudgetProgress`, `resolvePeriod()` calculator; Prisma `Budget` + `BudgetAlertEvent` + `users.due_reminder_days`; expand-only migration (shipped 2026-07-04)         | period-calculator unit tests (DST, ISO weeks); migration test                                           |
| 10.2 ✅ | `BudgetModule`: create/get/patch/delete/archive endpoints, scope+role guards, DTO validation, error codes, audit actions, `budget.updated` SSE (shipped 2026-07-13)                                                          | unit + integration (scope matrix: owner/admin/member/outsider)                                          |
| 10.3    | `CreateBudgetDialog` + `BudgetFormDialog` (scope select w/ remember, category picker, period + custom range, threshold slider); i18n EN+HE                                                                                   | unit + interaction                                                                                      |
| 10.4    | `/budgets` list page (cards, filters, archived toggle) + edit/delete/archive flows wired                                                                                                                                     | unit + interaction + E2E smoke                                                                          |
| 10.5    | Progress service + `GET /budgets/:id/progress` (+ `?periods=N`, `?breakdown=member`, `excludedOtherCurrencyCount`); `EXPLAIN`-verified index usage; progress inline in list/get                                              | unit (aggregate math) + integration (attribution/currency/category matrix)                              |
| 10.6    | Personal dashboard budgets section + `/budgets/[budgetId]` detail page (progress ring, history bars, counted transactions via `<TransactionsList>`)                                                                          | unit + interaction                                                                                      |
| 10.7    | Group budgets end-to-end: admin-only mutations, member visibility, group-scope progress; group budget creation from the group page                                                                                           | integration (role matrix) + unit                                                                        |
| 10.8    | Group dashboard Budgets tab with per-member breakdown UI                                                                                                                                                                     | unit + interaction                                                                                      |
| 10.9    | `dedup_key` migration (§3) + `BUDGET_ALERTS_QUEUE` evaluator (event-driven jobs from `transaction.*` events + hourly sweep) + re-arm-on-edit in PATCH + email templates + `budget.alert` SSE + `GET /budgets/alerts` history | unit (worker, dedup, re-arm) + integration (threshold/overspend fire-once; re-fire after material edit) |
| 10.10   | `TRANSACTION_DUE_QUEUE` daily worker + `due_reminder_days` setting UI + due emails; audit matrix completion; i18n EN+HE sweep; dark-mode pass; Playwright E2E (create → spend → progress → alert); merge to production       | full suite                                                                                              |

Each iteration ships with unit/integration tests, i18n keys where UI is
touched, CI-green push, and a progress-notes entry — Phase 6/7 cadence.
Every iteration is independently deployable; 10.9/10.10 workers are
guarded by env flags (`BUDGET_ALERTS_ENABLED`, default true) so a
worker-side incident can be disabled without a rollback.

## 9. Risks & Open Questions

| Risk / question                                                      | Mitigation / decision                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Progress query cost on large histories                               | Aggregate hits `(direction, occurred_at)` + attribution indexes; period-bounded; measured in 10.5, materialize only if p95 > 500ms |
| Timezone edge cases (period boundaries, DST)                         | Single shared `resolvePeriod()` with exhaustive unit tests; boundaries half-open `[start, end)`                                    |
| Alert spam on transaction backdating (period re-crosses threshold)   | Dedup key is per budget-period — fires once per period unless the budget itself is materially edited (§2.5 re-arm); documented     |
| Nullable-FK composite unique never fires on MariaDB (NULLs distinct) | Replaced with a required computed `dedup_key` column + unique (§3); migration in 10.9 while the table is still empty               |
| Email deliverability failures blocking the worker                    | Mail send is fire-and-forget with error logging (Phase 4 pattern); SSE still delivered                                             |
| Group creator's timezone for group budgets is arbitrary              | Acceptable v1 simplification; column-free (derived); revisit with a group setting if users ask                                     |
| `CUSTOM` budgets after `endsAt`                                      | Worker skips them; UI shows "ended" state; archive suggested in detail page                                                        |
