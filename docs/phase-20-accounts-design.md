# Phase 20: Accounts, Balances & Bank Sync — Design Document

> **Status**: Designed 2026-09-25 — iteration plan in §10; the bank-sync research it rests on is §3
> **Plan**: [`IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md) §5 — Phase 20 (added 2026-09-25)
> **Depends on**: Phase 6 (Transaction entity, attributions, categories, realtime), Phase 5 (groups,
> roles), Phase 7–8 (receipt-backed transactions are matched and enriched like any other)
> **Feeds**: Phase 10.9 (low-balance alerts finally have a balance), Phase 11 (MCP account/balance
> tools), Phase 12.5/12.9 (bot `/balance`, alerts), Phase 16 (LLM advisor context), Phase 9 (analytics
> per account — a later dimension)

## 1. Overview

Today every transaction floats: the app knows _what_ was spent, not _from where_, and it has no
notion of how much money there is. This phase adds the missing base layer:

1. **Accounts** — bank accounts, credit cards, cash wallets — scoped like budgets (personal or
   group), each with a currency and a running **ledger balance** derived from transactions.
2. **Bank sync** — statement lines imported from the bank or card issuer become the "bank truth"
   against which the app **reconciles** its own transactions: every line is either matched to an
   existing transaction (manual or receipt-born), turned into a new one, recorded as a transfer
   between two of the user's accounts, or ignored. Enrichment flows both ways (§5).
3. **Transfers** — a first-class money movement between two accounts that never counts as
   spending, which is what makes Israeli credit-card billing cycles add up (§2.4).

The AI layers that come next (advisors, forecasts, helpers) need exactly these three facts:
where money is, where it goes, and whether the record agrees with the bank.

### User stories covered ([`SPECIFICATION-USER-STORIES.md`](../SPECIFICATION-USER-STORIES.md))

- As a personal user, I can set reminders for due payments and **low balance alerts**.
- As a Telegram user, I can check **balances** and reminders through a bot.
- As a web app user, I can set up notifications about **low balances**.
- (new, this phase) As a user, I can register my bank accounts and cards, import their statements
  securely, and have the app reconcile them with what I already entered — asking me only when it
  cannot decide, and never blocking me.

### Explicitly deferred

| Concern                                         | Where / why                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Server-side bank scraping with stored passwords | **Never** — §3.5. Bank credentials do not enter the server, in any form.                                             |
| Open Banking (Israeli PSD2-style API)           | Not available to an unlicensed individual app (§3.1); the import API is shaped so an aggregator could feed it later. |
| Cross-currency transfers                        | v1 transfers require both accounts to share a currency; FX belongs to the (unbuilt) FX layer.                        |
| Investment / securities accounts                | `OTHER` kind holds a balance and nothing more.                                                                       |
| Per-account analytics dimension                 | Phase 9 (`account` dimension) once accounts carry enough history.                                                    |
| Bot / MCP surfaces                              | Phases 11–13 consume the same endpoints.                                                                             |
| Interest, fees forecasting                      | Phase 16 territory.                                                                                                  |

## 2. Core concepts

### 2.1 Account = scoped container with a currency and an anchor

An `Account` has a `kind` (`BANK | CARD | CASH | OTHER`), an optional `institution` from the
shared closed list (§4.1), one `currency`, a scope (`personal` → `ownerId`, or `group` →
`groupId`, exactly as `Budget`), an optional masked identifier (`last4` — never a full account or
card number), and a **balance anchor**: `openingBalanceCents` at `openingBalanceAt`. The anchor is
the user's statement "on this date this account held X"; everything after it is derived.

Roles mirror budgets: create / edit / archive / delete need the owner or a group **admin**; every
group member can read, **import statements and reconcile lines** (data entry, like adding a group
transaction). Non-accessors get 404, never a leak.

### 2.2 Ledger balance is derived, never stored

`ledgerBalanceCents(account, at = now)` =
`openingBalanceCents` + Σ over **countable** transactions with `occurredAt ∈ [openingBalanceAt, at)`:

- rows with `accountId = A`: `+amountCents` for `IN`, `−amountCents` for `OUT`;
- rows with `transferAccountId = A`: `+amountCents` (an incoming transfer).

**Countable** is the analytics rule (`status = 'POSTED' AND type = 'ONE_TIME'`): recurring / plan
parents are templates, `PENDING` and `DUE` occurrences are not money yet. One aggregate query per
list call (`groupBy` on `accountId` and on `transferAccountId` for the listed ids) — no stored
balance, no drift.

### 2.3 Reported balance and the reconciliation gap

The bank's own number is kept separately: `reportedBalanceCents` at `reportedBalanceAt`, written by
an import that carries a statement balance or by the user (PATCH). The **gap** =
`reported − ledger(as of reportedBalanceAt)`. A non-zero gap plus pending lines is the nudge
("3 lines to review, ₪412.00 unexplained"); a zero gap is the reward. Nothing is enforced — the gap
is information, reconciliation is optional and resumable.

### 2.4 Transfers and the Israeli card cycle

A **transfer** is one `Transaction` row with `direction = 'OUT'`, `accountId` = source,
`transferAccountId` = destination (both visible to the caller, distinct, same currency), primary
category = the new system category `transfer` (direction `BOTH`). It is excluded from spending
everywhere by one predicate — `transfer_account_id IS NULL` — in the analytics `base` CTE, in
budget progress (10.5) and in the dashboard totals.

Israeli cards accrue purchases over a cycle and the bank debits the total on one billing day. The
model: each purchase is an `OUT` on the `CARD` account (that is where the receipt-born and manual
expenses already belong); the bank's monthly "ISRACARD / CAL / MAX …" line is a **transfer**
bank → card. `CARD` accounts carry `billingAccountId` (the bank account) and `billingDay` (1–28),
which the matcher uses to recognise the bill line (§5.3). The card's ledger balance is therefore
"what is owed this cycle" — the UI rule is `kind === 'CARD' && ledgerBalanceCents < 0` ⇒ shown as _owed_ (absolute value, neutral tone), never as a red debt.

### 2.5 Statement lines are the bank truth; transactions are the app's record

An `AccountStatementLine` is one row from a statement. It is immutable except for its lifecycle:

| Status    | Meaning                                                               | `transactionId` |
| --------- | --------------------------------------------------------------------- | --------------- |
| `PENDING` | imported, waiting for a decision (the review queue)                   | null            |
| `MATCHED` | linked to a transaction that already existed (manual, receipt, plan…) | set             |
| `CREATED` | a transaction (or transfer) was created from it                       | set             |
| `IGNORED` | the user decided it is not to be tracked (kept for dedup and audit)   | null            |

Unlink (`DELETE …/link`) returns a line to `PENDING` and clears `transactionId`; the transaction
is left alone. Lines are deduplicated per account by a server-computed `fingerprint` (§4.2), so
re-importing an overlapping statement is safe and idempotent.

### 2.6 Realtime

One advisory event, `account.updated { accountId }`, published post-commit on every account
mutation, import and line decision (recipients: owner or all group members). Clients refetch the
account list / detail on receipt and on `resyncToken`, per `docs/ui-realtime-conventions.md`.
Transaction events already fire for the transactions a line decision creates or edits.

## 3. Bank-sync research and the security decision (2026-09-25)

_Sources and detail: the research notes in §3.6. Every claim below was checked on 2026-09-25;
"unverified" marks what could not be confirmed from a primary source._

### 3.1 Open Banking in Israel

The Bank of Israel / Israel Securities Authority open-banking regime (Berlin-Group-derived API)
exposes account information only to **licensed** account-information service providers. An
individual's self-hosted app cannot obtain that licence; there is no personal-developer sandbox
with live data. Aggregators exist for businesses, not for a family app. **Decision: not a channel
for this phase.** The import API (§6.2) accepts the same normalised line shape an aggregator would
deliver, so nothing here blocks adopting one later.

### 3.2 `israeli-bank-scrapers` and the tools built on it

The open-source Node library drives the banks' own web sites with a headless browser and returns a
normalised transaction shape (identifier, date, processedDate, originalAmount/currency,
chargedAmount, description, memo, type normal/installments, status completed/pending, installment
number/total). It covers Hapoalim, Leumi, Isracard, Visa Cal, Max, Amex, Discount, Mizrahi and
more. It needs the user's **login credentials** and, for several institutions, an OTP; it breaks
whenever a bank changes its site. Tools built on it (Caspion, Moneyman) all share one security
architecture: **the scraper runs on the user's own machine or in the user's own CI account with
secrets they control; the finance app only receives the resulting rows.**

### 3.3 Manual exports

Every institution in scope offers a spreadsheet export from its web site or app (XLSX; Leumi an
HTML table named `.xls`; CSV at some; Hebrew headers — the verbatim column lists per institution
are in the research notes §3; `dd/mm/yyyy` dates; debit/credit columns on bank statements, a
charged-vs-original amount pair and an installment marker on card statements; a running balance
column on bank statements; no OFX/QIF/CAMT). Exports carry no stable row identifier that survives
re-export at every institution, which is why dedup is a computed fingerprint (§4.2).

### 3.4 Reconciliation heuristics in the field

Actual Budget, Firefly III, YNAB and the ledger-family importers converge on the same rules: an
exact amount match is the hard gate; a date window of a few days absorbs card posting delays;
description similarity and learned payee→category rules rank the rest; a hash of
institution + date + amount + description dedups re-imports; pending rows are re-matched when they
post; transfers between own accounts are detected by an equal-and-opposite pair or by a known
counter-party token. §5 is that consensus, tuned to this schema.

### 3.5 The decision — security first, automation second

| Channel                                                     | Where credentials live | Where files are parsed | Verdict                            |
| ----------------------------------------------------------- | ---------------------- | ---------------------- | ---------------------------------- |
| **A. Manual export → drag into the app** (20.4–20.5)        | nowhere                | the user's browser     | **ship first**                     |
| **B. User-run connector on `israeli-bank-scrapers`** (20.7) | the user's own device  | the user's own device  | ship second, behind a scoped token |
| C. Open Banking via a licensed aggregator                   | the aggregator         | —                      | design-compatible, not built       |
| D. Server-side scraping with stored bank passwords          | our database           | our server             | **rejected — never**               |

Both shipped channels end in the same place: `POST /accounts/:id/imports` with normalised lines
(§6.2). The server never receives a statement file and never stores a bank credential. Channel A
parses spreadsheets **in the browser** — the untrusted binary never touches the API, no upload
storage exists, and the same pure parsing code (`packages/shared`) is what the connector reuses.

### 3.6 Research notes

Kept short here; the full report with links lives in `docs/notes/bank-sync-research-2026-09.md`.

## 4. Data model

### 4.1 Shared types and constants (`packages/shared/src/types/account.types.ts`, `constants/institutions.ts`)

```ts
export const ACCOUNT_KINDS = ['BANK', 'CARD', 'CASH', 'OTHER'] as const;
export const ACCOUNT_INSTITUTIONS = [
  /* Israeli banks */ 'hapoalim',
  'leumi',
  'discount',
  'mizrahi',
  'beinleumi',
  'yahav',
  'otsar',
  'mercantile',
  'onezero',
  /* card issuers */ 'isracard',
  'cal',
  'max',
  'amex',
  'other',
] as const;
/** Display name, kinds an institution issues, and the description tokens that identify its
 *  monthly bill on a bank statement (used by the transfer proposal, §5.3). */
export const INSTITUTION_META: Record<
  AccountInstitution,
  { name: string; kinds: AccountKind[]; billTokens?: string[] }
>;
export const ACCOUNT_IMPORT_SOURCES = [
  'hapoalim',
  'leumi',
  'discount',
  'mizrahi',
  'isracard',
  'cal',
  'max',
  'amex',
  'generic_csv',
  'manual',
  'connector',
] as const;
export const STATEMENT_LINE_STATUSES = ['PENDING', 'MATCHED', 'CREATED', 'IGNORED'] as const;
export const STATEMENT_SUGGESTED_ACTIONS = ['match', 'transfer', 'create', 'none'] as const;
export const ACCOUNT_IMPORT_MAX_LINES = 2000;
export const STATEMENT_MATCH_DATE_WINDOW_DAYS = 5;
export const STATEMENT_MATCH_CONFIDENT_SCORE = 0.8;
export const ACCOUNT_LAST4_PATTERN = /^\d{2,4}$/;
export interface ImportLineInput {
  postedAt: string; // ISO date (yyyy-mm-dd) — the bank's posting date
  valueAt?: string; // ISO date — purchase date on card statements, when it differs
  amountCents: number; // positive
  direction: 'IN' | 'OUT';
  currency: string; // ISO-4217; defaults to the account currency
  description: string; // raw, as printed (≤ 300 chars)
  memo?: string; // second free-text column when present (≤ 300)
  externalId?: string; // reference number when the export has one (≤ 64)
  balanceAfterCents?: number; // running balance column
  originalAmountCents?: number; // card statements: amount in the purchase currency
  originalCurrency?: string;
  installmentNumber?: number; // "תשלום 2 מתוך 6"
  installmentTotal?: number;
  categoryHint?: string; // the issuer's own sector column, if any (≤ 100)
}
```

Statement parsing (`packages/shared/src/statement/`): `parseStatementRows(rows: string[][], preset?)`
→ `{ preset, lines: ImportLineInput[], statementBalanceCents?, statementBalanceAt?, periodFrom?,
periodTo?, warnings[] }`. Pure, dependency-free; presets are **data** — header dictionaries (Hebrew
and English), date formats, sign conventions, amount-pair semantics — one engine, no per-bank code
paths. Header auto-detection picks the preset; a `generic_csv` preset maps by common column names
and lets the web fall back to a manual column picker. Spreadsheet decoding to `string[][]` is a web
concern (`apps/web/src/lib/statement/decode.ts`: CSV with `windows-1255` / UTF-8 detection via
`TextDecoder`, XLSX/XLS — including Leumi's HTML-table-as-`.xls` — via SheetJS ≥ 0.20.3 from the SheetJS CDN
tarball, web-only; see `docs/notes/bank-sync-research-2026-09.md` §6 for why not the npm `xlsx`).

### 4.2 Prisma (expand-only migration `20260925120000_phase20_2_accounts`)

```prisma
// ── Phase 20: Accounts, balances & bank sync ──

model Account {
  id          String  @id @default(uuid()) @db.VarChar(36)
  name        String  @db.VarChar(100)
  // BANK | CARD | CASH | OTHER
  kind        String  @db.VarChar(10)
  // One of ACCOUNT_INSTITUTIONS or null (cash, unknown).
  institution String? @db.VarChar(20)
  currency    String  @db.VarChar(3)
  // Masked identifier only — never a full account or card number.
  last4       String? @db.VarChar(4)
  color       String? @db.VarChar(16)

  // Scope: exactly one of ownerId / groupId, mirroring budgets.
  scopeType String  @map("scope_type") @db.VarChar(10)
  ownerId   String? @map("owner_id") @db.VarChar(36)
  owner     User?   @relation("AccountOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  groupId   String? @map("group_id") @db.VarChar(36)
  group     Group?  @relation(fields: [groupId], references: [id], onDelete: Cascade)

  // Balance anchor (design §2.2): everything after it is derived.
  openingBalanceCents Int      @default(0) @map("opening_balance_cents")
  openingBalanceAt    DateTime @default(now()) @map("opening_balance_at")
  // Bank-stated balance (design §2.3): from an import or the user, never derived.
  reportedBalanceCents Int?      @map("reported_balance_cents")
  reportedBalanceAt    DateTime? @map("reported_balance_at")

  // CARD only: the bank account debited on the billing day (design §2.4).
  billingAccountId String?   @map("billing_account_id") @db.VarChar(36)
  billingAccount   Account?  @relation("CardBilling", fields: [billingAccountId], references: [id], onDelete: SetNull)
  billedCards      Account[] @relation("CardBilling")
  billingDay       Int?      @map("billing_day") // 1..28

  archivedAt  DateTime? @map("archived_at")
  createdById String    @map("created_by_id") @db.VarChar(36)
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  transactions         Transaction[]          @relation("TransactionAccount")
  incomingTransfers    Transaction[]          @relation("TransactionTransferAccount")
  imports              AccountImport[]
  statementLines       AccountStatementLine[]

  @@index([ownerId, scopeType, archivedAt])
  @@index([groupId, scopeType, archivedAt])
  @@map("accounts")
}

model AccountImport {
  id           String  @id @default(uuid()) @db.VarChar(36)
  accountId    String  @map("account_id") @db.VarChar(36)
  account      Account @relation(fields: [accountId], references: [id], onDelete: Cascade)
  importedById String  @map("imported_by_id") @db.VarChar(36)
  // One of ACCOUNT_IMPORT_SOURCES.
  source       String  @db.VarChar(20)
  originalName String? @map("original_name") @db.VarChar(255)
  periodFrom   DateTime? @map("period_from")
  periodTo     DateTime? @map("period_to")
  statementBalanceCents Int?      @map("statement_balance_cents")
  statementBalanceAt    DateTime? @map("statement_balance_at")
  // Outcome counters (design §6.2), frozen at import time.
  totalCount     Int @default(0) @map("total_count")
  insertedCount  Int @default(0) @map("inserted_count")
  duplicateCount Int @default(0) @map("duplicate_count")
  createdAt DateTime @default(now()) @map("created_at")

  lines AccountStatementLine[]

  @@index([accountId, createdAt])
  @@map("account_imports")
}

model AccountStatementLine {
  id        String        @id @default(uuid()) @db.VarChar(36)
  accountId String        @map("account_id") @db.VarChar(36)
  account   Account       @relation(fields: [accountId], references: [id], onDelete: Cascade)
  importId  String        @map("import_id") @db.VarChar(36)
  import    AccountImport @relation(fields: [importId], references: [id], onDelete: Cascade)
  // sha256 over (accountId, postedAt, direction, amountCents, normalizedDescription,
  // ordinal-among-equal-rows-in-the-import). Dedup fence — a reference number or a
  // running balance is deliberately NOT hashed: one export variant of the same row
  // carries it and another does not (20.4 security review, L5).
  fingerprint String @db.VarChar(64)

  postedAt DateTime  @map("posted_at")
  valueAt  DateTime? @map("value_at")
  direction   String @db.VarChar(3)
  amountCents Int    @map("amount_cents")
  currency    String @db.VarChar(3)
  description           String  @db.VarChar(300)
  normalizedDescription String  @map("normalized_description") @db.VarChar(300)
  memo                  String? @db.VarChar(300)
  externalId            String? @map("external_id") @db.VarChar(64)
  balanceAfterCents     Int?    @map("balance_after_cents")
  originalAmountCents   Int?    @map("original_amount_cents")
  originalCurrency      String? @map("original_currency") @db.VarChar(3)
  installmentNumber     Int?    @map("installment_number")
  installmentTotal      Int?    @map("installment_total")
  categoryHint          String? @map("category_hint") @db.VarChar(100)

  // PENDING | MATCHED | CREATED | IGNORED (design §2.5)
  status        String       @default("PENDING") @db.VarChar(10)
  transactionId String?      @unique @map("transaction_id") @db.VarChar(36)
  transaction   Transaction? @relation(fields: [transactionId], references: [id], onDelete: SetNull)
  // Matcher output, recomputed on demand: { action, transactionId?, categoryId?, transferAccountId?,
  // score, candidates: [{ transactionId, score }] } — opaque snapshot.
  suggestion Json?
  decidedAt   DateTime? @map("decided_at")
  decidedById String?   @map("decided_by_id") @db.VarChar(36)
  createdAt   DateTime  @default(now()) @map("created_at")

  @@unique([accountId, fingerprint])
  @@index([accountId, status, postedAt])
  @@index([accountId, normalizedDescription])
  @@map("account_statement_lines")
}
```

`Transaction` gains two nullable columns and one relation each, both `SetNull` on account delete:

```prisma
  accountId         String?  @map("account_id") @db.VarChar(36)
  account           Account? @relation("TransactionAccount", fields: [accountId], references: [id], onDelete: SetNull)
  // Set only on transfers (design §2.4): the destination account. direction is always OUT.
  transferAccountId String?  @map("transfer_account_id") @db.VarChar(36)
  transferAccount   Account? @relation("TransactionTransferAccount", fields: [transferAccountId], references: [id], onDelete: SetNull)
  statementLine     AccountStatementLine?

  @@index([accountId, occurredAt])
  @@index([transferAccountId, occurredAt])
```

`User` gains `accountsOwned Account[] @relation("AccountOwner")`; `Group` gains `accounts Account[]`.
System categories gain `{ slug: 'transfer', name: 'Transfer', direction: 'BOTH', icon: 'arrow-right-left' }`
in a new `DEFAULT_BOTH_CATEGORIES` list (`DEFAULT_CATEGORIES` becomes 26 rows; the seed already
iterates directions generically). The migration is purely additive; no contract step is needed.
Deleting an account SetNulls transactions (they keep counting as spend, just unplaced) and cascades
imports and lines — a deliberate "forget this account" semantics, confirmed in the UI.

## 5. Matching and enrichment

### 5.1 Candidate pool

For a `PENDING` line L on account A, candidates are transactions **visible to the actor**
(`buildVisibilityWhere`), `type = 'ONE_TIME'`, `status ∈ {POSTED, PENDING, DUE}` (a bank line can
settle a pending plan occurrence), `currency = L.currency`, `direction = L.direction`,
`amountCents = L.amountCents` (exact — the hard gate), `occurredAt` within
`±STATEMENT_MATCH_DATE_WINDOW_DAYS` of `L.valueAt ?? L.postedAt`, no `statementLine` yet, and
`accountId ∈ {null, A}`. Never a transfer row.

### 5.2 Score

`score = 0.60 (amount) + 0.25 · (1 − |Δdays| / window) + 0.15 · max(sim(L.normalizedDescription, x))`
where `x` ranges over the transaction's note, the linked receipt's merchant `normalizedName` and
the primary category name, `sim` = `trigramSimilarity` (`product/utils/trigram.util.ts`, reused, moved
to `common/utils/` when it grows a second consumer). `+0.10` when `accountId = A` already. The
suggestion is `match` when the best score ≥ `STATEMENT_MATCH_CONFIDENT_SCORE` **and** leads the
runner-up by ≥ 0.10; otherwise the candidates are listed and the action falls through to §5.3/§5.4.

### 5.3 Transfer proposal

If A is `BANK`, L is `OUT`, and `normalizedDescription` contains a `billTokens` entry of an
institution for which the actor can see a `CARD` account C with `billingAccountId = A` (or, failing
that, with that `institution`), the suggestion is `transfer → C`. Symmetrically an `IN` line on a
`CARD` whose description matches its billing bank is `transfer` from the bank — but the bank side
usually creates the transfer first, in which case the card-side line **matches** the existing
transfer row (§5.1 accepts `transferAccountId = A` rows for `IN` lines on the card, the one place a
transfer is a candidate). Equal-and-opposite lines between two own accounts within the window are
also proposed as a transfer.

### 5.4 Create proposal and category memory

Otherwise the suggestion is `create` with `categoryId` = the primary category of the most recent
`MATCHED`/`CREATED` line in the same scope whose `normalizedDescription` equals L's (one indexed
query, no new table — the lines table _is_ the memory); failing that, the category of a receipt
whose merchant `normalizedName` is a token match; failing that `null` — the review UI shows the
row as "needs a category" and bulk-apply skips it. Attributions default to the account's scope
(personal → the actor; group → the group).

### 5.5 Enrichment both ways

- **Line → transaction** (on `match`): set `accountId = A` when null; flip `PENDING`/`DUE` to
  `POSTED` (the bank confirmed it); the line's `postedAt` is kept on the line, `occurredAt` is not
  rewritten. Audit `TRANSACTION_UPDATED` with `reason: 'statement_match'`.
- **Transaction → line** (on `POST /transactions` and on receipt confirm, when `accountId` is set):
  post-commit, best-effort, `StatementMatchingService.autoLink(transaction)` links the **single**
  `PENDING` line that would score as a confident match; ambiguity does nothing. The user sees the
  result in the review queue and can unlink. This is what makes a receipt photographed on Tuesday
  and a statement imported on Friday meet without a click.
- **Skippable prompts**: nothing in either direction blocks; the review queue is the only place
  the app asks, one row at a time, with "apply all confident suggestions" for the impatient.

## 6. API (`apps/api/src/account/`)

All routes under `/api/v1`, `JwtAuthGuard`, throttles as budgets (30/min mutations, 120/min reads,
imports 10/min). Errors in `constants/account-errors.ts`: `ACCOUNT_NOT_FOUND`, `ACCOUNT_FORBIDDEN`,
`ACCOUNT_ARCHIVED`, `ACCOUNT_INVALID_SCOPE`, `ACCOUNT_INVALID_BILLING`, `ACCOUNT_CURRENCY_MISMATCH`,
`ACCOUNT_IMPORT_TOO_LARGE`, `ACCOUNT_IMPORT_INVALID_LINE`, `STATEMENT_LINE_NOT_FOUND`,
`STATEMENT_LINE_NOT_PENDING`, `STATEMENT_LINE_ALREADY_LINKED`, `STATEMENT_MATCH_INVALID`.
Transaction errors gain `TRANSACTION_ACCOUNT_NOT_FOUND`, `TRANSACTION_ACCOUNT_CURRENCY_MISMATCH`,
`TRANSACTION_TRANSFER_INVALID`.

### 6.1 Accounts

| Method | Path                                 | Body / query → response                                                                              | Role                |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------- |
| POST   | `/accounts`                          | `CreateAccountDto` → `AccountResponseDto` (201)                                                      | owner / group admin |
| GET    | `/accounts`                          | `?scope=all\|personal\|group:<id>&includeArchived=&cursor=&limit=` → `{ data, nextCursor, hasMore }` | owner / member      |
| GET    | `/accounts/:id`                      | → `AccountResponseDto`                                                                               | owner / member      |
| PATCH  | `/accounts/:id`                      | `UpdateAccountDto` (name, institution, last4, color, opening*, reported*, billing\*) → dto           | owner / group admin |
| DELETE | `/accounts/:id`                      | → 204; transactions SetNull, imports + lines cascade                                                 | owner / group admin |
| POST   | `/accounts/:id/archive`, `unarchive` | → dto                                                                                                | owner / group admin |

`AccountResponseDto` = the columns + `ledgerBalanceCents`, `ledgerBalanceAt`, `pendingLinesCount`,
`reconciliationGapCents` (null when no reported balance). Scope and currency are immutable after
creation (recreate to move). `billingAccountId` must be a visible `BANK` account in the same scope
and currency; `billingDay` requires it.

### 6.2 Imports and lines

| Method | Path                                    | Body / query → response                                                                                                                                                            |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/accounts/:id/imports`                 | `CreateImportDto { source, originalName?, lines: ImportLineDto[] ≤ 2000, statementBalanceCents?, statementBalanceAt?, periodFrom?, periodTo? }` → `AccountImportResponseDto` (201) |
| GET    | `/accounts/:id/imports`                 | cursor list → `AccountImportResponseDto[]`                                                                                                                                         |
| GET    | `/accounts/:id/lines`                   | `?status=&importId=&suggestion=match\|transfer\|create\|none\|needs_input&cursor=&limit=` → `StatementLineResponseDto[]` (with `suggestion` resolved, below)                       |
| POST   | `/accounts/:id/lines/:lineId/match`     | `{ transactionId }` → line (+ enriched transaction, §5.5)                                                                                                                          |
| POST   | `/accounts/:id/lines/:lineId/create`    | `{ categoryIds, note?, attributions? }` → line + created `TransactionSummaryDto`                                                                                                   |
| POST   | `/accounts/:id/lines/:lineId/transfer`  | `{ transferAccountId }` → line + created transfer                                                                                                                                  |
| POST   | `/accounts/:id/lines/:lineId/ignore`    | → line                                                                                                                                                                             |
| DELETE | `/accounts/:id/lines/:lineId/link`      | → line back to `PENDING`                                                                                                                                                           |
| POST   | `/accounts/:id/lines/apply-suggestions` | `{ lineIds? }` → `{ matched, transferred, created, skipped }` — confident suggestions only                                                                                         |

**Resolved suggestion shape** (`StatementSuggestionDto`, what the review UI renders):
`{ action: 'match'|'transfer'|'create'|'none', score: number, transaction?: TransactionSummaryDto,`
`categoryId?: string, category?: TransactionCategorySummary, transferAccountId?: string,`
`candidates: { transaction: TransactionSummaryDto, score: number }[] /* top 5, best first */ }`.
The stored `suggestion` JSON holds ids and scores only; the list endpoint resolves them in one
batched `findMany` per page (never per line). `suggestion=needs_input` selects `none` and `create`
without a `categoryId`, so the review filters are server-side and pagination-safe. A statement
longer than `ACCOUNT_IMPORT_MAX_LINES` is submitted by the browser in consecutive chunks of that
size (one import row per chunk, same `originalName`). Undo is per line (`DELETE …/link`); there is
no bulk undo, which is why the web guards "apply all" above 20 lines with a confirm.

`POST /imports` is one DB transaction: validate lines, compute fingerprints, insert those not yet
present (`accountId + fingerprint` unique — duplicates are counted, never errors), then run the
matcher over the inserted lines and store each `suggestion`; if `statementBalanceAt` is newer than
`reportedBalanceAt`, update the account's reported balance. `AccountImportResponseDto` carries the
counters plus `suggestedMatchCount / suggestedTransferCount / suggestedCreateCount / needsInputCount`
so the wizard's last step can say what will happen. Audit `ACCOUNT_IMPORT_CREATED`,
`STATEMENT_LINE_MATCHED/CREATED/TRANSFERRED/IGNORED/UNLINKED`, `ACCOUNT_*` for CRUD.

Line decisions call `TransactionService.create` / `update` (never a parallel write path) so
category, currency, attribution validation, audit and realtime stay in one place.

### 6.3 Transactions (changes)

- `CreateTransactionDto` / `UpdateTransactionDto`: `accountId?: string | null`,
  `transferAccountId?: string | null`. Validation: account visible and not archived; currency equal
  to the transaction's; transfer ⇒ `direction = 'OUT'`, `accountId` set, both accounts distinct,
  same currency; changing `accountId` on a `MATCHED` transaction is allowed (the line follows).
- `TransactionSummaryDto`: `accountId`, `transferAccountId`, `statementLineId` (null unless linked).
- `ListTransactionsQueryDto`: `accountId` (matches `accountId` **or** `transferAccountId`),
  `excludeTransfers=true`.
- Analytics `purchaseRowsCte` base: `AND t.transfer_account_id IS NULL`. Dashboard `TotalsCard`
  skips rows with `transferAccountId`. Budget progress (10.5) inherits the same clause.

### 6.4 Connector token (20.7)

A **personal access token** table (`api_tokens`: hashed like refresh tokens, `scopes` string, `name`,
`lastUsedAt`, `expiresAt`, revocable from settings) and an `ApiTokenGuard` accepted only by
`POST /accounts/:id/imports` with scope `accounts:import`. The connector (`apps/connector`, a CLI the
user runs on their own machine) reads credentials from its own local config, scrapes with
`israeli-bank-scrapers`, maps the scraper shape to `ImportLineInput`, and pushes with the token. The
server side is ~150 lines; the safety property is structural — there is no endpoint that could
accept a bank password.

## 7. Web

Routes, components and data flow follow the budgets pattern (`lib/<domain>` context with
`AbortSignal` everywhere, `useAsyncOperation` scopes per surface, committed filters, realtime
refetch). Specs: `docs/ui/20.3-accounts.md`, `docs/ui/20.5-statement-import-review.md`.

| Surface                      | What                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/accounts`                  | cards per account (name, institution, kind, last4, ledger balance, reported balance + gap, pending-lines badge), scope tabs, archived toggle, **Import** and **New account**                      |
| `/accounts/[accountId]`      | balance header; tabs **Review** (pending lines with one-tap suggestion accept, per-row change, "apply all"), **Transactions** (reused `TransactionsList` with `accountId`), **Imports** (history) |
| `AccountFormDialog`          | create / edit; kind → institution list narrows; CARD shows billing account + day; opening balance + date; last4                                                                                   |
| `ImportStatementDialog`      | 3 steps: drop / pick file (`FileCaptureButtons`) → parsed preview (detected format, row count, period, balance, warnings; manual column mapping fallback) → result summary with a link to Review  |
| `AccountSelect`              | the one select of visible accounts (currency-filtered), used by `TransactionFormDialog`, `TransactionsFilters`, the transfer picker                                                               |
| Dashboard `AccountsOverview` | per-currency net position + per-account balances, pending-lines nudge                                                                                                                             |
| Transaction row / detail     | account chip; "bank-confirmed" mark when `statementLineId` is set; transfer rows render "→ destination"                                                                                           |
| Sidebar                      | **Accounts** between Transactions and Budgets                                                                                                                                                     |

Every string in `accounts.*` in both locales. Spreadsheet decoding runs in the browser
(`lib/statement/decode.ts`); the API only ever sees JSON.

## 8. UI kit (iteration 20.1 — prerequisite for the surfaces above)

The inventory of `components/ui` (wiki `ui-design-system.md`) has primitives for async state and
dialogs' _behaviour_, but not for the shells every page rebuilds by hand. Measured on 2026-09-25:
22 hand-rolled `role="dialog"` shells, 17 raw `<select>`s sharing one class string, 34 card shells
with the same border/background classes, 8 `<h1>` variants, 24 ad-hoc empty states. 20.1 extracts:

| Component    | Replaces                                                            | Props (sketch)                                                                  |
| ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Dialog`     | every `fixed inset-0 … role="dialog"` shell incl. `ConfirmDialog`'s | `open`, `title`, `onClose`, `size sm\|md\|lg\|full`, `testId`, `footer`, `busy` |
| `Select`     | every raw `<select>`                                                | `label`, `error`, `options`/children — same contract as `Input`                 |
| `Textarea`   | the 4 raw `<textarea>`s                                             | as `Input`                                                                      |
| `Checkbox`   | the 3 raw checkboxes / toggles                                      | `label`, `description`                                                          |
| `Card`       | the 34 shells                                                       | `padding sm\|md\|lg`, `as`, `muted`                                             |
| `Badge`      | the chip spans (scope / category / status)                          | `tone neutral\|primary\|success\|warning\|danger`                               |
| `PageHeader` | the `<h1>` + actions rows                                           | `title`, `description`, `actions`                                               |
| `EmptyState` | the ad-hoc "nothing here" blocks                                    | `title`, `description`, `action`, `icon`                                        |
| `Tabs`       | `TransactionsScopeTabs` becomes a thin wrapper                      | `items`, `current`, `onChange`, `disabled`                                      |
| `Stat`       | new — balance / total figures                                       | `label`, `value`, `hint`, `tone`                                                |

Rule from here on: a new surface composes these; a new visual pattern goes through `ui-designer`
and lands in `components/ui`, never inline. Behaviour (focus trap, scroll lock, ESC, backdrop) moves
into `Dialog` once, so the 22 copies cannot drift.

## 9. Security

- No bank credential, statement file or account number is ever stored or logged; `last4` is the
  only identifier and is user-entered. Import bodies are validated per line (DTO whitelist, size
  caps, `ACCOUNT_IMPORT_MAX_LINES`), never echoed in error messages beyond an index.
- Visibility is the budgets matrix; every line and import is reached through its account.
  Transaction candidates are filtered by the actor's own visibility, so a group member cannot match
  a group line to a personal transaction they cannot see.
- Statement descriptions are untrusted text: rendered as text, never as markup; normalisation
  strips control characters.
- The connector token is scoped, hashed at rest, shown once, revocable, and accepted by one route.
- `security-reviewer` gates 20.2 (scoping + transaction changes), 20.4 (import intake) and 20.7.

## 10. Iteration plan

| Iteration | Objective                      | Scope                                                                                                                                                                              | Testing                              |
| --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 20.1      | UI kit                         | §8 components extracted from existing instances; every instance replaced; wiki inventory updated                                                                                   | web unit (existing specs stay green) |
| 20.2      | Accounts schema + API          | §4 shared types, migration, `transfer` category, `AccountModule` CRUD + balances, transaction `accountId`/`transferAccountId` + filters, transfer exclusion in analytics/dashboard | unit + integration                   |
| 20.3      | Accounts UI                    | `/accounts`, `AccountFormDialog`, `AccountSelect` in the transaction form and filters, dashboard widget, nav, i18n                                                                 | UI + E2E                             |
| 20.4      | Statement parsing + import API | shared parser + presets (generic CSV, Hapoalim, Leumi, Isracard, Cal, Max), browser decoder, `POST /imports`, dedup, matcher, line endpoints, apply-suggestions                    | unit + integration                   |
| 20.5      | Import & review UI             | `ImportStatementDialog`, `/accounts/[id]` review / transactions / imports, fixture statements, Playwright flow                                                                     | UI + E2E                             |
| 20.6      | Two-way enrichment             | auto-link on create / receipt confirm, plan-occurrence settle, category memory, reconciliation gap on cards and dashboard                                                          | integration + E2E                    |
| 20.7      | Connector                      | `api_tokens` + settings UI, `apps/connector` CLI on `israeli-bank-scrapers`, docs; security review                                                                                 | unit + integration + manual          |
| 20.8      | Balance alerts + release       | per-account low-balance threshold feeding the 10.9 alert worker; progress docs; production                                                                                         | full suite                           |

Migrations: one, in 20.2 (the slot holder); 20.7 adds `api_tokens` as a second additive migration.
Parallel tracks: 20.1 ∥ 20.2 ∥ UI specs; then 20.3 ∥ 20.4; then 20.5; then 20.6 ∥ 20.7.

## 11. Risks and open questions

- **Export formats drift.** Presets are data; a broken preset degrades to the manual column picker,
  never to a failed import. Fixture files (anonymised, synthetic) pin each preset in unit tests.
- **Duplicate-looking rows** (two identical coffees the same day) rely on the ordinal tie-breaker;
  a bank that reorders identical rows between exports could produce one duplicate — acceptable,
  visible, deletable.
- **Card statement "charged" vs "original" amount**: the line's `amountCents` is always the charged
  amount in the account currency (that is what moves money); the original pair is kept for display.
- **Installments**: each monthly charge is its own line and its own transaction; the plan link
  (`INSTALLMENT` parent) is a 20.6 refinement — v1 matches occurrence rows by amount and date.
- **Group visibility of personal transactions**: a group account's line can only match what the
  actor can see; a member who cannot see another member's personal transaction will get a `create`
  suggestion instead — the other member's own review shows the match. Documented, not solved.
- **`israeli-bank-scrapers` legality / ToS**: the connector is the user's tool on the user's
  machine with the user's credentials — the same position as the existing community tools. The
  app never runs it.
