# Transactions (checked 2026-09-24)

Read when: touching `apps/api/src/transaction/**`, `apps/api/src/category/**`, or the `/transactions`, `/dashboard`, `/settings/categories` web surfaces. Receipts, budgets and analytics all read this domain.

Phase 6 shipped this as "Payment"; migration `20260715120000_rename_payments_to_transactions` renamed the entity end to end. `docs/phase-6-transactions-design.md` and `docs/phase-6-progress.md` still say Payment in places — **code wins**.

## Domain model

| Model (table)                  | Meaning                                                | Key rules                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Transaction` (`transactions`) | One money row, IN or OUT; also the recurring template. | `amountCents` positive Int, `currency` ISO-4217, `status` POSTED/PENDING/DUE/CANCELLED, `categoryId` = PRIMARY category, `parentTransactionId` on occurrences |
| `TransactionAttribution`       | Which scope(s) own the row                             | ≥1 required; unique `(transactionId, scopeType, userId, groupId)`; drives all visibility                                                                      |
| `Category` (`categories`)      | System / user / group category                         | unique `(ownerType, ownerId, slug, direction)`; `direction` IN/OUT/**BOTH**                                                                                   |
| `TransactionCategory`          | ADDITIONAL categories, 1-based `position`              | primary lives only on `transactions.category_id`, never duplicated here; 5 total max (`TRANSACTION_MAX_CATEGORIES`)                                           |
| `TransactionSchedule`          | Recurrence spec, 1:1 with a RECURRING parent           | exactly one of `cron` / `everyMs` (service invariant, no DB CHECK); `pausedAt` / `cancelledAt` soft states                                                    |
| `TransactionPlan`              | Installment / loan / mortgage, 1:1 with parent         | `cancelledAt` terminal; N child occurrences pre-generated at create time                                                                                      |
| `TransactionComment`           | Thread on a transaction                                | soft delete via `deletedAt`; author-only edit/delete                                                                                                          |
| `TransactionStar`              | Per-user favourite                                     | unique `(transactionId, userId)` — not a shared flag                                                                                                          |
| `TransactionDocument`          | Phase 6 attachment placeholder                         | no write path in this module; the live attachment is the linked receipt                                                                                       |

Types `ONE_TIME`, `RECURRING`, `LIMITED_PERIOD`, `INSTALLMENT`, `LOAN`, `MORTGAGE` and all other enums are string unions in `packages/shared/src/types/transaction.types.ts` (no Prisma enums — columns are `VarChar`). Create accepts `SUPPORTED_CREATE_TYPES = ONE_TIME | RECURRING` plus the three plan kinds; `LIMITED_PERIOD` still returns `TRANSACTION_TYPE_NOT_IMPLEMENTED`.

**Direction unification.** No Income/Expense entities — one table, one code path, `direction` as the sign. The original Phase 6 (income) and Phase 7 (expense) were merged for exactly this reason (`IMPLEMENTATION-PLAN.md` §5 "Phase 6" preamble), so every list, form, filter and aggregation is shared.

## Scopes, attributions, visibility

- A scope is `personal` (the caller) or `group:<groupId>`; `POST /transactions` takes an array of `AttributionDto`, so multi-scope is normal. Group attribution requires membership (`TRANSACTION_ATTRIBUTION_OUT_OF_SCOPE`).
- **Visible iff** some attribution is `scopeType='personal' AND userId=me`, or `scopeType='group'` on a group I belong to. One predicate: `TransactionService.buildVisibilityWhere()`; sibling services use `assertVisible()`. Invisible ⇒ 404, never 403 — no existence leak.
- **Edit is creator-only** (`TRANSACTION_NOT_OWNER`); visibility alone is not enough.
- **Delete is scope removal.** `DELETE ?scope=personal|group:<id>|all` removes only caller-accessible attributions; an omitted scope with >1 accessible ⇒ 409 `TRANSACTION_SCOPE_AMBIGUOUS` listing them. When the last attribution goes the row is hard-deleted, and FK cascade takes stars, comments, documents, schedule, plan **and child occurrences**.
- **No on-behalf-of.** `transaction_attributions.user_id` is only ever the caller's id (`transaction.service.ts` ~L362); an `on_behalf_of_user_id` column is deferred (design §12).

## Categories

- Owner types `system` (seeded, immutable — `CATEGORY_SYSTEM_IMMUTABLE`) / `user` / `group`; group category writes need the **group admin** role (`CATEGORY_GROUP_NOT_ADMIN`).
- 25 system defaults (18 OUT + 7 IN) in `packages/shared/src/constants/default-categories.ts`, upserted idempotently by `seed-system-categories.ts` (prisma seed, integration setup, and `SystemCategoriesBootstrap` on API boot).
- Direction filtering is a superset match: `direction IN (requested, 'BOTH')`.
- Deleting an in-use category requires `?replaceWithCategoryId=`; the service reassigns primary and additional rows in one transaction, de-duplicating where the replacement is already attached, and audits `CATEGORY_REASSIGNED`.
- **Multi-category** since migration `20260724100000_multi_category_transactions`: `categoryIds` is ordered, element 0 = primary, every id must match the transaction's direction. The `categoryId` list filter is an any-match over primary ∪ additional.

## Recurring schedules

Producer `TransactionScheduleService` ⇄ consumer `TransactionOccurrenceProcessor` over `TRANSACTION_OCCURRENCES_QUEUE = 'transaction-occurrences'`, job name `TRANSACTION_OCCURRENCE_JOB = 'create-occurrence'`, scheduler id `transaction-schedule:<scheduleId>` (`utils/schedule-cascade.ts` — the format is a contract). Job opts: `attempts: 3`, exponential backoff 5 s.

| Trigger                            | Behaviour                                                                                                                                | Audit                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `POST /schedule`                   | row + `upsertJobScheduler`; a queue failure is retried once, then the DB write rolls back                                                | `TRANSACTION_SCHEDULE_CREATED`            |
| `POST /pause` / `/resume`          | `pausedAt` set/cleared, scheduler removed/re-upserted, `nextRunAt` recomputed by `computeNextRunAt`                                      | `_PAUSED` / `_RESUMED`                    |
| `POST /cancel`                     | terminal `cancelledAt`, scheduler removed, **row preserved** for child provenance                                                        | `_CANCELLED`                              |
| `DELETE /schedule`                 | hard-delete row + scheduler key                                                                                                          | `TRANSACTION_SCHEDULE_DELETED`            |
| Parent edited RECURRING → other    | silent tear-down inside the parent-edit tx (no 409)                                                                                      | `_DELETED` `reason='parent_type_changed'` |
| Parent edited ONE_TIME → RECURRING | **no** auto-create; the client must POST the schedule                                                                                    | —                                         |
| Parent hard-deleted                | tear-down before the FK cascade fires                                                                                                    | `_DELETED` `reason='parent_deleted'`      |
| Worker fire                        | child `ONE_TIME` row, status POSTED, parent's economic shape + cloned attributions/categories, `idempotencyKey = <scheduleId>:<firedMs>` | `TRANSACTION_OCCURRENCE_CREATED`          |

The worker skips (success, no throw) on missing schedule, `pausedAt`, `cancelledAt`, missing parent, or parent no longer RECURRING; the missing-schedule and the two parent cases also call `removeJobScheduler` to self-heal. A P2002 on `idempotencyKey` means BullMQ re-fired the same logical time; it returns the existing occurrence. `TransactionScheduleService` re-upserts every live schedule `OnApplicationBootstrap` because schedulers live only in Redis keyed by queue name (Phase 8.20 — the rename would otherwise have silently stopped every recurrence).

## Plans and amortisation

- The plan body arrives **inline on `POST /transactions`** when `type ∈ {INSTALLMENT, LOAN, MORTGAGE}`: a plan parent without its rows would be a broken invariant, unlike the two-step schedule create.
- `utils/amortization.util.ts` is pure math; `transaction-plan.create.ts` validates (before the tx opens) and writes inside it; `transaction-plan.service.ts` does read + terminal cancel only — no PATCH/regenerate.
- `equal` (default for INSTALLMENT): integer-cent split, the first `principal % N` rows carry one extra cent so rows sum to the principal exactly. `french` (default for LOAN/MORTGAGE): annuity `A = P·r / (1 − (1+r)^−n)` with `r = annualRate / PERIODS_PER_YEAR[frequency]`, interest rounded per row on the declining balance, **last row absorbs all rounding** so the balance lands on 0.
- Dates are UTC; month-based frequencies anchor to the first due date's day-of-month and clamp (Jan 31 → Feb 28 → Mar 31, not Mar 28) via `addMonthsAnchored`.
- Children: N rows, `status: 'PENDING'`, `idempotencyKey = plan:<planId>:<index>`, attributions and additional categories cloned from the parent. Cancel flips remaining PENDING children to CANCELLED — rows are never deleted, for audit. Limits: `PLAN_TRANSACTIONS_COUNT_MAX = 600`, `interestRate ∈ [0, 1]`.

## Comments, stars, documents, dashboard

Comments are cursor-paginated oldest-first; any accessor may post, only the author may edit or soft-delete, group admins cannot moderate. Stars are a per-user toggle (`?starred=true` filter, `starredByMe` on summaries). Documents: the live attachment is the **receipt** — `Transaction.receipt` back-link, included by `TRANSACTION_DETAIL_INCLUDE`, rendered by the web `TransactionDocuments` panel (see [receipts.md](receipts-and-llm.md)).

**There is no server aggregation endpoint in this domain.** `/dashboard` widgets call `GET /transactions` and aggregate client-side: `computeMonthRange()` gives the UTC `[first-of-month, first-of-next-month)` window and `TotalsCard` sums IN/OUT per currency over a single page (limit 100), showing a "partial totals" badge when `hasMore`. Server-side rollups live in the analytics module (see [analytics.md](analytics-and-budgets.md)).

## API surface

All routes sit under the global `/api/v1` prefix and `JwtAuthGuard`; limits are per-caller/minute via `@CustomThrottle`.

| Method     | Path                                               | DTOs in → out                                                                                     | Limit |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----- |
| POST       | `/transactions`                                    | `CreateTransactionDto` → `TransactionSummaryDto` (201)                                            | 30    |
| GET        | `/transactions`                                    | `ListTransactionsQueryDto` → `TransactionListResponseDto`                                         | 120   |
| GET        | `/transactions/:id`, `/:id/occurrences`            | (list query on occurrences) → summary / `TransactionListResponseDto`                              | 120   |
| PATCH      | `/transactions/:id`                                | `UpdateTransactionDto` + `UpdateTransactionQueryDto` → summary \| `CascadeEditResponseDto` \| 204 | 30    |
| DELETE     | `/transactions/:id`                                | `DeleteTransactionQueryDto` → `AttributionChangeResultDto` (200)                                  | 30    |
| POST       | `/transactions/:id/star`                           | → `ToggleStarResponseDto`                                                                         | 60    |
| GET        | `/transactions/:id/comments`                       | `ListCommentsQueryDto` → paged `CommentResponseDto`                                               | 120   |
| POST/PATCH | `/transactions/:id/comments[/:commentId]`          | `CreateCommentDto` / `UpdateCommentDto` → `CommentResponseDto`                                    | 20    |
| DELETE     | `/transactions/:id/comments/:commentId`            | → 204 (soft delete)                                                                               | 20    |
| POST/PUT   | `/transactions/:id/schedule`                       | `CreateScheduleDto` (201) / `UpdateScheduleDto` → `ScheduleResponseDto`                           | 30    |
| GET/DELETE | `/transactions/:id/schedule`                       | → `ScheduleResponseDto` (120/min) / 204                                                           | 30    |
| POST       | `/transactions/:id/schedule/{pause,resume,cancel}` | → `ScheduleResponseDto`                                                                           | 30    |
| GET/DELETE | `/transactions/:id/plan`                           | → `PlanResponseDto` (+ amortisation rows); DELETE = terminal cancel, 200                          | 60/30 |
| GET        | `/categories`, `/categories/:id`                   | `ListCategoriesQueryDto` → `CategoryResponseDto`                                                  | 120   |
| POST/PATCH | `/categories[/:id]`                                | `CreateCategoryDto` / `UpdateCategoryDto` → `CategoryResponseDto`                                 | 20    |
| DELETE     | `/categories/:id`                                  | `DeleteCategoryQueryDto` → reassign summary (200)                                                 | 20    |

`PATCH /transactions/:id` has two modes: **omit** `propagate` for legacy single-edit semantics (generated-occurrence guard; emptying attributions ⇒ 204 + hard delete); **pass** `propagate=self|future|all` to route through `editTransactionWithPropagation`, the only path allowed to edit a RECURRING parent's non-period fields. It cascades scalar/attribution deltas to children (`future` = `occurredAt >= now`); period changes do not regenerate occurrences yet. Error codes: `constants/transaction-errors.ts`, `category/constants/category-errors.ts`.

## Realtime

Producers publish on the in-process `EventBus` post-commit, best-effort — a publish failure is logged and never breaks the mutation. Recipients come from `computeTransactionRecipients()`: the same personal ∪ member-group predicate, creator always included. Union: `apps/api/src/realtime/events.types.ts` — `transaction.created|updated|deleted`, `transaction_attribution.added|removed`, `comment.created|updated|deleted`, `occurrence.created`, `schedule.created|updated|paused|resumed|cancelled|deleted`.

Web consumers: `TransactionsList` (runs `transactionMatchesFilters` before inserting/removing a row), `transaction-detail-client`, `TransactionCommentList`, `RecurringOccurrencesSection`, and `dashboard-client` (one top-level subscription, 500 ms debounce → `refreshKey` remount). The channel is **advisory** — no buffer, no replay — so every subscriber must also refetch on `resyncToken` (`useRealtimeResync`). See [realtime.md](ui-design-system.md).

## Web surfaces

- `/transactions` — `transactions-list-client.tsx` orchestrator owns fetch + URL; renders `TransactionsScopeTabs` (all / personal / `group:<id>`) + `TransactionsFilters` + `TransactionsList`. The list has two modes: orchestrator-owned (`data` prop) and self-fetch (dashboard widgets).
- `/transactions/[transactionId]` — header, schedule badge + lifecycle controls, plan section, occurrences section, comments, documents. `/dashboard` — `TotalsCard`, `RecentActivity`, `StarredTransactions`, `ScopeEntryCards`, `QuickAddTransactionButton`. `/settings/categories` — `CategoryListSection` / `CategoryFormDialog` / `DeleteCategoryDialog`.
- URL-synced filters: `lib/transaction/filters.ts` is the single URL ↔ state mapping (`defaultFilters`, `filtersToQuery`, `filtersFromQuery`, `isFiltersDirty`); default-valued keys are dropped from the URL. `childScope` = all | parents | occurrences maps to the API's `withParent`.
- All data access goes through `TransactionProvider` (`lib/transaction/transaction-context.tsx`); every method takes an `AbortSignal` and callers drive it with `useAsyncOperation`.

## Tests

- API unit: `apps/api/src/transaction/*.spec.ts` (service 3.2 kloc, controllers, comment/schedule/plan services, occurrence processor) + `utils/{amortization,next-run-at,schedule-cascade,transaction-event-recipients}.spec.ts` + `apps/api/src/category/*.spec.ts`.
- API integration (`apps/api/test/integration/`): `transactions-{create,list,edit,delete,star,comments,plan,cascade-edit}`, `transaction-schedule{,-lifecycle,-cascade}`, `transaction-occurrence`, `categories`, `system-categories`, `queue`.
- Web: co-located `*.spec.tsx` beside every component, plus `lib/transaction/__tests__/*` (filters, formatters, context, remember, matches-filters).
- E2E `apps/web/e2e/payments.spec.ts` (old filename): ONE_TIME → RECURRING → LOAN $10,000 @ 5% × 12, asserting the **$856.07** reference annuity → terminal plan cancel.

## Invariants

1. **Money is integer cents.** `amountCents` is a positive Int capped at `MAX_AMOUNT_CENTS = 1e11`; never float a stored amount — floats appear only in intermediate annuity math and are rounded once per row.
2. **Rounding closes.** `equal` spreads the remainder over the first rows, `french` dumps it on the last; rows must sum to the principal exactly, or the plan lies about the debt.
3. **Everything is UTC** — `occurredAt`, plan due dates, cron evaluation (`tz: 'UTC'`), the dashboard month window. No server-local time, because users and workers sit in different zones.
4. **One visibility predicate, one include.** New read paths use `buildVisibilityWhere` / `assertVisible` (invisible ⇒ 404) and `TRANSACTION_DETAIL_INCLUDE` / `buildDetailInclude(userId)`, so responses cannot drift per endpoint.
5. **Schedule cascade has one chokepoint**, `removeScheduleForTransaction()`. Inside a caller tx it skips the Redis write (Redis I/O under open row locks deadlocked MySQL); the caller must `removeJobScheduler` post-commit with the returned `scheduleId`.
6. **Idempotency keys are the fence** against double-creation: `<scheduleId>:<firedMs>` (fire time floored to the second) and `plan:<planId>:<index>`, both on a unique index — P2002 is a no-op, not an error.
7. **Realtime is advisory**: post-commit, best-effort, recipients via `computeTransactionRecipients`. Never gate correctness on an event; always pair a subscription with a `resyncToken` refetch.
8. **Every financial mutation is audited** (`TRANSACTION_*` / `CATEGORY_*` on `AuditLog`), best-effort so an audit failure never fails the user-facing operation.

## Known drift and gotchas

- Design §"Cascade rules" says child occurrences become "orphaned-but-valid" when the parent is hard-deleted. The FK is `ON DELETE CASCADE` (`schema.prisma` relation `TransactionOccurrences`, migration `20260715120000`), so **children die with the parent** — code wins.
- Docs, the audit-log matrix and the E2E filename still say `Payment` / `payments.spec.ts`; the action strings in code are `TRANSACTION_*`. Never copy doc action names into code.
- `EventBus` is a process-local rxjs Subject: events do not cross blue/green slots during a deploy overlap and delivery breaks entirely under horizontal scale-out (`docs/phase-6.18.1.4-realtime-rca.md` §"Latent"). Redis pub/sub behind the same interface is the intended fix.
- Hidden tabs deliberately close their SSE stream and nothing is replayed — that is why `resyncToken` exists. The realtime provider never calls `/auth/refresh` itself; it waits for the api-client's `BroadcastChannel('auth')` message (`docs/phase-6.18.1.4-rca.md` — the 401 storm).
- "Exactly one of `cron` / `everyMs`" is a service-level invariant only; Prisma emits no MySQL CHECK for it.
- `TransactionDocument` has a table but no write path here — use the receipt link instead.
- `LIMITED_PERIOD`, plan PATCH/attach, `plan.*` realtime events and the destructive period-change warning are explicitly deferred (`docs/phase-6-progress.md` §"Iteration 6.21").

## Deep dive

`docs/phase-6-transactions-design.md`: §2.3 Attribution model · §2.4 Delete semantics · §4.2 Prisma schema · §5.2 Transactions (incl. the `GET /transactions` query) · §5.5 Schedules · §5.6 Plans · §5.7 Error codes · §5.8 Rate limiting · §"Schedule lifecycle (iteration 6.17.4)" · §12 "Category visibility policy". `docs/phase-6-progress.md`: §6.17.1–6.17.4, §6.18.1.4-hotfix, §6.19, §6.21 (audit matrix + E2E). `docs/ui-realtime-conventions.md` §"Gap recovery — resyncToken".
