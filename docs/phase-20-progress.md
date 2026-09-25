# Phase 20 — Accounts, Balances & Bank Sync

## 20.0 — Research and design (2026-09-25)

Owner request: solid tracking of wallet balances, budgets and bank-account integration as the
base for the AI layer. Researched the Israeli sync options (Open Banking licensing, the
`israeli-bank-scrapers` ecosystem, manual export formats, reconciliation heuristics in the
field) and fixed the security order — browser-parsed manual import first, user-run connector
second, no server-side credentials ever. Wrote
[`phase-20-accounts-design.md`](phase-20-accounts-design.md), the plan rows (Phase 20, 8
iterations), [`wiki/accounts-and-sync.md`](../wiki/accounts-and-sync.md), the `playwright-qa`
skill and the search-before-you-write rule for the architect and coder roles.

### Decisions

- Transfers are one `Transaction` row with `transferAccountId`; spend totals exclude them by one
  predicate (`transfer_account_id IS NULL`).
- Balances are derived (opening anchor + countable rows); the bank's reported balance is stored
  separately and the gap is information, never enforced.
- Statement files never reach the server: parsing happens in the browser, the API receives
  normalised lines; dedup is a per-account fingerprint.
- A UI kit (20.1) precedes the new surfaces so they are composed from primitives that replace
  the hand-rolled dialog, select and card shells.

## 20.2 — Accounts schema + API (2026-09-25)

Per design §4, §6.1, §6.3. Merged as `29c57ee` (track branch `p20/accounts-api`, nine commits) plus the security-review
merge (six more commits).

### Scope

- **`packages/shared`** — `types/account.types.ts` (kinds, statuses, suggested actions, import
  sources, match constants, `ImportLineInput`), `constants/institutions.ts` (`ACCOUNT_INSTITUTIONS`,
  `INSTITUTION_META` with card-bill tokens), `DEFAULT_BOTH_CATEGORIES` with the `transfer` system
  category (`TRANSFER_CATEGORY_SLUG`; 26 defaults).
- **Prisma** — additive migrations `20260925120000_phase20_2_accounts` (`accounts`,
  `account_imports`, `account_statement_lines`, `transactions.account_id` /
  `transfer_account_id`, indexes) and `20260925120100_phase20_2_category_direction_width`
  (`categories.direction` VARCHAR(3) → VARCHAR(4): `BOTH` had been a legal value since Phase 6
  but nothing had ever stored it). `migrate diff` clean.
- **`AccountModule`** — CRUD + archive/unarchive with the budgets role matrix (owner / group
  admin mutate; owner / member read; 404 for outsiders), derived ledger balance
  (`opening + Σ countable rows` in `[openingBalanceAt, ledgerBalanceAt)`, two `groupBy`
  queries per list call), reported balance + reconciliation gap, `pendingLinesCount`, audit
  `ACCOUNT_*`, SSE `account.updated`. `utils/account-visibility.ts` is the one visibility
  predicate, shared with the transaction service.
- **Transactions** — `accountId` / `transferAccountId` on create, update and summaries,
  `statementLineId` on summaries, `accountId` + `excludeTransfers` list filters, occurrences and
  plan children clone the account; a transfer must be `OUT`, between two distinct visible
  accounts of the same currency, with the `transfer` system category as its only category
  (`TRANSACTION_TRANSFER_INVALID`). `transaction/utils/countable.ts` holds the countable
  predicate; the analytics `base` CTE excludes `transfer_account_id IS NOT NULL` rows.
- **Web** — `TransactionSummary` fields, `TotalsCard` skips transfers, `account.updated`
  mirrored in `realtime-types.ts`.

### Tests

shared 174 · api unit 1353 (91 suites) · web unit 1370 · integration:
`accounts-crud` (23) + `transactions-accounts` (15) new, `analytics-query` (transfer exclusion
case), `transactions-create/edit/cascade-edit`, `receipts-confirm`, `system-categories` green.
Known pre-existing red: `transactions-list` test 19 trips the 30/min POST throttle on a local
run.

### Security review (2026-09-25)

`security-reviewer` verdict on the first merge: fix first. Three integrity findings, all closed
in the second merge: the propagation editor (`PATCH ?propagate=`) bypassed the account guard
(a transfer could be flipped to `IN` and inflate both ledgers); generated occurrences cloned
the template's account without re-checking archive state or the creator's visibility; amount
and date edits on a placed row skipped re-validation, so an ex-member could move a shared
balance. Rulings: placement is re-checked on every scalar edit of a placed row; archived
accounts keep their history editable but accept no new placement; a group ledger sums every
countable row placed on it regardless of the reader's transaction visibility (documented
invariant); every money cap derives from one `MAX_MINOR_UNITS` (the MySQL INT ceiling) —
the budget cap was 47× above its column. Process note: the built-in `security-review` skill
diffs the primary working directory, so the reviewer ran the pass manually against the phase
worktree.

**Next** — 20.4 (statement parsing + import API) in parallel with 20.3 (accounts UI, after the
20.1 UI kit lands).
