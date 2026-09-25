# Accounts and bank sync (checked 2026-09-25)

Read when: touching `apps/api/src/account/**`, `packages/shared/src/{types/account.types.ts,constants/institutions.ts,statement/**}`, the `/accounts` web surfaces, `apps/connector`, or any code that must know where money sits or whether a transaction is bank-confirmed.

Design: [`docs/phase-20-accounts-design.md`](../docs/phase-20-accounts-design.md). Status (2026-09-25): 20.1 UI kit, 20.2 schema + API and 20.4 parser + import API + review queue are merged on `phase/20`; 20.3 accounts UI and 20.5 import/review UI merged; 20.6–20.8 open — until an iteration has an entry in `docs/phase-20-progress.md`, its facts below are the contract, not shipped behaviour.

## Domain model

| Model (table)                                      | Meaning                                                                | Key rules                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Account` (`accounts`)                             | bank account, card, cash wallet, other                                 | `kind` BANK/CARD/CASH/OTHER, one `currency`, scope exactly like `Budget` (`scopeType` + one of `ownerId`/`groupId`), `last4` only |
| `AccountImport` (`account_imports`)                | one statement import (file parsed in the browser, or a connector push) | counters frozen at import; the raw file is **never** stored                                                                       |
| `AccountStatementLine` (`account_statement_lines`) | one bank line — the bank truth                                         | `@@unique(accountId, fingerprint)` dedups re-imports; `status` PENDING/MATCHED/CREATED/IGNORED; `transactionId` unique (1:1)      |
| `Transaction.accountId`                            | where the money moved                                                  | nullable, SetNull; must be visible, unarchived, same currency                                                                     |
| `Transaction.transferAccountId`                    | set only on a **transfer** (destination)                               | direction OUT, distinct from `accountId`, same currency; excluded from spend by `transfer_account_id IS NULL`                     |

Balances are **derived** (design §2.2): `opening + Σ countable rows` from the anchor (`openingBalanceAt`; the epoch when the account was created without one, so every row counts) where countable = `status='POSTED' AND type='ONE_TIME'` — the analytics rule. `reportedBalance*` is the bank's number (from an import or the user); the gap between the two is information, never enforced.

## Roles (mirror budgets)

Create / edit / archive / delete: owner or group **admin**. Read, **import, reconcile lines**: owner or any member. Non-accessor ⇒ 404. Transaction candidates for a line are filtered by the actor's own visibility.

## Sync channels (design §3.5)

1. **Manual export → browser parse → `POST /accounts/:id/imports`** with normalised lines. Presets are data in `packages/shared/src/statement/`; decoding (CSV `windows-1255`/UTF-8, XLSX) lives in `apps/web/src/lib/statement/`.
2. **User-run connector** (`apps/connector`, 20.7) on `israeli-bank-scrapers`, pushing the same shape with a scoped personal access token (`accounts:import`). Credentials stay on the user's machine.
3. Open Banking: not available to an unlicensed app — design-compatible only.
4. Server-side scraping / stored bank passwords: **never**.

## Matching (design §5)

Hard gate: exact `amountCents`, same currency and direction, `occurredAt` within ±`STATEMENT_MATCH_DATE_WINDOW_DAYS` (5) of the line date, no statement line yet, `accountId ∈ {null, this}`. Score = 0.60 amount + 0.25 date proximity + 0.15 description trigram similarity (`trigramSimilarity`, reused) + 0.10 same account; confident ≥ `STATEMENT_MATCH_CONFIDENT_SCORE` (0.8) with a 0.10 lead. Card-bill lines on a BANK account become a **transfer** proposal to the CARD whose `billingAccountId` is that bank. Otherwise `create` with the category remembered from earlier lines with the same `normalizedDescription` in the same scope (the lines table is the memory — no extra table). Enrichment both ways: a match sets the transaction's `accountId` and settles PENDING/DUE to POSTED; a new transaction with an account auto-links the single confident pending line, post-commit, best-effort.

## API surface (design §6)

`/accounts` CRUD + `archive`/`unarchive` (30/120 per min), `/accounts/:id/imports` (10/min, ≤ `ACCOUNT_IMPORT_MAX_LINES` = 2000 lines), `/accounts/:id/lines` list + `match` / `create` / `transfer` / `ignore` / `DELETE link` / `apply-suggestions`. Line decisions go through `TransactionService.create/update` — never a parallel write path. Realtime: `account.updated { accountId }`, advisory. Audit: `ACCOUNT_*`, `ACCOUNT_IMPORT_CREATED`, `STATEMENT_LINE_*`.

## Web (design §7–8)

`lib/account/` context + types, `components/account/*`, routes `/accounts` and `/accounts/[accountId]` (Review / Transactions / Imports). Everything composes the 20.1 UI kit (`Dialog`, `Select`, `Card`, `Badge`, `PageHeader`, `EmptyState`, `Tabs`, `Stat`). `AccountSelect` is the one account picker. Namespace `accounts.*` in both locales.

**Import (20.5).** `ImportStatementDialog` decodes the file in the browser (`lib/statement/decode.ts`: CSV as UTF-8 or windows-1255, XLSX / BIFF `.xls` / HTML-as-`.xls` through SheetJS 0.20.3 from the SheetJS CDN tarball — pinned by URL with a sha512 integrity in the lockfile, so it sits outside registry advisory tooling and needs a manual version check; code-page tables wired in, first sheet only, rows capped, cells kept as text so day-first dates survive; the file name is stored with digit runs redacted), parses with the shared `parseStatementRows`, and posts only the normalised lines — in consecutive chunks of `ACCOUNT_IMPORT_MAX_LINES`, the statement balance on the last one. An unrecognised format opens `StatementColumnMapper` (date plus a signed amount or a debit/credit pair unblocks the import). Every entry point (the `/accounts` header, a card's menu, the detail page) opens the same dialog.

**Review (20.5).** `/accounts/[accountId]` (`account-detail-client.tsx`) has the three balances, URL-synced tabs (`?tab=review|transactions|imports`, `&import=<id>` narrows the queue) and defaults to Review while lines are pending. `AccountReviewQueue` seeds one `LineDecision` per line from the matcher's suggestion (`StatementLineCard`), accepts through the four decision endpoints, keeps decided rows in memory for the `decided` filter, and undoes through `DELETE …/link`. Server filters: `all` / `needsInput` (`status=PENDING`, `suggestion=needs_input`); `suggested` and `decided` narrow the fetched page client-side because the API has no single value for them. Keyboard: ↑↓ move, Enter accept, M/C/T switch, I ignore, S skip, U undo, Esc leaves. A fetch that was aborted (a newer fetch, StrictMode's double effect) never opens the retry dialog — the `signal.aborted` guard that also fixed the transactions list.

## Invariants

1. No bank credential, statement file or full account number is stored, logged or echoed.
2. One dedup fence: `(accountId, fingerprint)` = sha256 over account, posting date, direction, amount, normalized description and the row's ordinal among identical tuples of its import — never a reference number or a running balance, which only some export variants carry. Duplicates are counted, never errors.
3. Transfers are one row and count in **no** spend total (analytics base CTE, budget progress, dashboard totals share the predicate).
4. Balances are never stored; the reported balance is never derived.
5. A group account's ledger sums **every** countable row placed on it, whatever the reader can see: a member's personal transaction on a shared account moves the shared balance, so the balance and `GET /transactions?accountId=` need not add up _for a given reader_ — by design (design §2.2), not a bug. Placement is therefore re-checked on every scalar edit of a placed row, so an editor who has lost access to the account cannot keep moving its balance through amount or date edits.
6. A line decision is always resumable and reversible (`DELETE …/link`), and nothing prompts modally.

## Tests

API: `apps/api/src/account/**/*.spec.ts`, `apps/api/test/integration/accounts-*.integration.spec.ts`; shared: `packages/shared/src/__tests__/statement-*.test.ts` with anonymised fixture rows per preset; web: specs beside components, `apps/web/e2e/accounts.spec.ts` (create → assign → import fixture → review → zero gap).
