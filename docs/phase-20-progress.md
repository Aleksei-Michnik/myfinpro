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

## 20.1 — UI kit (2026-09-25)

Per design §8. Merged as `b68ae9e` (track branch `p20/ui-kit`, twelve commits).

### Scope

`components/ui/` gained `Dialog` (THE modal shell — `panel` and `sheet` variants, behaviour in
one hook `lib/ui/use-dialog-behaviour.ts`: scroll lock, ESC, focus trap, focus restore — also
used by the two full-screen surfaces that keep their own chrome), `Select`, `Textarea`,
`Checkbox` (the `Input` contract, control classes from one `controlClass()` in
`input-styles.ts`), `Card` (+ `cardClass()`), `Badge`, `PageHeader`, `EmptyState`, `Tabs`
(`TransactionsScopeTabs` is now a wrapper), `Stat` (the dashboard totals figures), and
`styles.ts` (`focusRing`, `surfaceClass`, `borderClass`, `cx`). Every hand-rolled instance was
replaced: 22 dialog shells, 17 raw selects, 4 textareas, 3 checkboxes, 34 card shells, the
`h1` variants and the ad-hoc empty states — `grep` for each pattern outside `components/ui`
returns nothing. `wiki/ui-design-system.md` inventory, page templates and gotchas updated
(backdrop dismiss is on mousedown; Tailwind utility precedence — size through props, never a
competing class).

### Tests

Web unit 130 files green at the merge (kit specs beside each primitive; existing specs kept,
fixed only where they asserted a class name). E2E `budgets` and `payments` flows re-run by the
track before the session limit cut it off; re-verified on `phase/20` in 20.3's QA pass.

**Next** — 20.3 (accounts UI) on the kit.

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

## 20.3 — Accounts UI (2026-09-25)

Per design §7 and `docs/ui/20.3-accounts.md`. Merged as `fcf110b` (track branch `p20/accounts-ui`,
six commits: `72f7131` account lib + provider, `48dc553` accounts page, `9826795` transaction
surfaces, `d4e087f` dashboard overview, `7740f20` ledger anchor, `07f4114` e2e). The web-coder
subagent was cut off by the session limit early on; the main session finished the iteration.

### Scope

- **`lib/account`** — types mirrored from the shared package, `formatters.ts` (`isCardOwed`,
  `displayLedgerCents`, `isReconciled`), `AccountProvider` in the budget-context shape plus a
  lazily loaded **directory** of every visible account (refreshed on `account.updated` and after a
  resync) so rows and headers show names from an id alone; `useOptionalAccounts` /
  `useAccountDirectory` degrade without a provider so existing specs keep rendering.
- **`/accounts`** — kit cards (kind, institution, masked digits, ledger balance, the bank's
  figure and the unexplained gap), scope tabs, archived toggle, row menu edit / archive / delete;
  `AccountFormDialog` (kind, scope and currency immutable after creation, billing account for
  cards); `AccountSelect` is the one picker (grouped by scope, filtered by currency / kind /
  scope, self-fetching unless a list is supplied). Sidebar item; provider mounted in the layout.
- **Transactions** — account picker and transfer toggle in the form (a transfer is one OUT row
  with `transferAccountId` and the system `transfer` category; direction and categories fold
  away), account / transfer / bank-confirmed badges on rows and the detail header, the direction
  pill reads **Transfer** in a neutral tone through `directionPresentation` (shared by both
  surfaces), `accountId` filter in the list and the query string, API errors land on their field.
- **Dashboard** — `AccountsOverview` (net position per currency, one row per account, review
  nudge, empty state) between the totals and the scope cards; the scope cards now skip transfers
  like the totals card.
- **API** — an account created without an opening date anchors its ledger at the epoch
  (`ANCHOR_EPOCH`), not at the creation instant: a same-minute transaction used to fall outside
  the countable window and the card showed zero after a transfer. Design §2.1 and the wiki say so.

### Visual QA (`playwright-qa`, throwaway spec, en light · he dark · Pixel 5)

Found and fixed before the merge: the kind select read a `kindOptions.*` key that never
existed (rendered as its path — the key-echo unit mock could not see it); the scope card counted
the 3,200 transfer as expense (its spec factory dropped the new field, so the branch was never
hit); the card name truncated to four letters on a phone (badges now wrap under the name, the
menu stays on the first line); overview amounts forced `dir="ltr"` unlike every other amount.
Recorded, not fixed (pre-existing, reproduced on `phase/20` without 20.3): a full page load of
`/transactions` in dev opens the retry dialog while the list renders — `wiki/gotchas.md`.
Hebrew strings are a first draft; `i18n-translator` review pending.

### Tests

web unit 1433 (134 files; new `AccountCard`, `AccountFormDialog` against the real messages,
`AccountsOverview`, account formatters, `directionPresentation`, scope-card transfer case) ·
api unit 1382 (`account.service` 39) · integration `accounts-crud` 23 · e2e `accounts.spec.ts`
green (create → place → transfer → balances 650 / 250 → dashboard → filter → edit → archive →
delete); `payments.spec.ts` repaired (it targeted the pre-8.20 route). Gate: typecheck, lint,
format, i18n parity clean.

## 20.5 — Statement import & review UI (2026-09-25)

Per design §4.1, §6.2, §7 and `docs/ui/20.5-statement-import-review.md`. Merged as `fb4e517`
(track branch `p20/accounts-ui`, five commits: `a5056bb` decoder + client methods, `4489106`
import wizard, `698e525` detail page + review queue, `539eb00` transactions-list abort fix,
the e2e). Built by the main session (subagents still limited).

### Scope

- **Decoder** — `lib/statement/decode.ts`: CSV as UTF-8 or windows-1255, XLSX / BIFF `.xls` /
  HTML-as-`.xls` through SheetJS **0.20.3 from the SheetJS CDN tarball** (pinned by URL in
  `apps/web/package.json`, code-page tables wired in, `raw: true` so day-first dates stay text),
  5 MB cap, first sheet only. Nothing binary leaves the browser.
- **Client** — `AccountProvider` gains `createImport`, `fetchImports`, `fetchLines`, `matchLine`,
  `createFromLine`, `transferFromLine`, `ignoreLine`, `unlinkLine`, `applySuggestions`; web types
  mirror the line / suggestion / import / apply DTOs.
- **`ImportStatementDialog`** — three steps; preview shows the detected format, rows, period,
  statement balance, first rows and warnings; unknown formats open `StatementColumnMapper`; lines
  post in **chunks of `ACCOUNT_IMPORT_MAX_LINES`** (design §6.2 — the spec's "block above the
  cap" was superseded by the design's chunking), statement balance on the last chunk; step 3 sums
  the chunks and offers the review link and a one-click apply. Entry points: `/accounts` header,
  card menu (account locked), detail page. `FileCaptureButtons` gained `camera={false}`.
- **`/accounts/[accountId]`** — balances, URL-synced tabs, Review by default while lines are
  pending; `AccountReviewQueue` + `StatementLineCard` + `LineCandidatesDialog` implement the
  decision model and the keyboard map from the spec; `AccountImportsList` narrows the queue to one
  import; `TransactionsList` gained `hide.account`. Deliberate deviations: the `suggested` and
  `decided` filters narrow the fetched page client-side (the API has no single value for either),
  the bulk apply and the step-3 apply act on every pending line of the account (the import
  response carries no line ids).
- **Fixed on the way** — the recorded gotcha: a fetch aborted by React's dev-only remount no
  longer opens the retry dialog on `/transactions`; the mount fetch is re-issued once instead.

### Visual QA (`playwright-qa`, throwaway spec, en light · he dark · Pixel 5)

Caught before the merge: a `<div>` inside a `<p>` (the list's `emptyState` is a title, not a
component), the wizard resetting to step 1 when the host refetched the account (reset keyed on
the id now), a duplicated "Transfer to" label, the toolbar sticking under the app header on phones
(sticky only from `lg:`), and a seed that used `reference` where the DTO says `externalId`.
Hebrew strings are a first draft; `i18n-translator` review pending for 20.3 + 20.5.

### Security review (2026-09-25)

Verdict on the 20.3 + 20.5 diff: **merge**, five low findings, all closed in `6c4ee00` except the
one that was a product call (taken here, reversible): the apply-suggestions loop shared by the
wizard and the queue now stops on a round that applies nothing or leaves the remainder unchanged,
with a hard ceiling; the decoder reads the first sheet only with a row cap (a zip-bomb workbook
cannot expand past the size cap into a frozen tab); Enter inside a native select never commits a
row; digit runs of five or more are redacted from the file name before it is sent (bank exports
put the account or card number there — design §9). The SheetJS CDN dependency is pinned with a
lockfile integrity but sits outside registry advisories (`wiki/accounts-and-sync.md`). Verified
clean: no HTML from untrusted text, nothing binary leaves the browser, `last4` only, the API stays
the enforcement point, bulk apply confirms above 20, no topology in files or messages.

### Hebrew (2026-09-25)

`i18n-translator` pass on `accounts.*` (`25ee008`): 19 strings — imperative buttons like the
sibling forms, direct validation phrasing, participle badges, an agreement fix in `emptyGap`,
impersonal `decided.ignored`; layout-sensitive strings flagged for a look in RTL: the mirrored
`row.transferTo` arrow, the shortcut list, the numeric ranges in validation.

### Tests

web unit 1458 (138 files; new: decoder 12, queue helpers, line card against the real messages,
wizard step 1 against the real messages, helpers) · e2e `accounts.spec.ts` green end to end
(create → place → transfer → balances → import 6 lines → review: create, undo, ignore by key,
decided filter → re-import all duplicates → imports and transactions tabs → edit → archive →
delete). Gate: typecheck, lint, format, i18n parity clean.

## 20.6 — Two-way enrichment (2026-09-25)

Per design §5.5. Merged from `p20/import-api` (six commits: `12d65f3` bus `subscribeAll`,
`1c475aa` + `313e55c` transaction-side ranking, `ba7f6d5` auto-link, `97c6201` integration,
`848c9a5` receipt placement) plus the web picker `56b3c21` from `p20/accounts-ui`.

### Scope

- **Transaction → line.** `StatementMatchingService.autoLink(actorId, transactionId)`: for a
  visible one-off on an account (not a transfer, no line yet, status POSTED / PENDING / DUE) it
  ranks the account's pending lines with the same currency, direction and exact amount inside the
  date window through the same pure scorer as the import path (`rankLinesForTransaction`, the
  mirror of `rankCandidates`; one generic `isConfidentMatch`) and links the single confident one
  through the same write path the manual `match` decision uses (`linkLineToTransaction`:
  conditional claim → `confirmByStatementLine` → audit → `account.updated`). Ambiguity does
  nothing; a lost race returns null; it never throws.
- **Trigger.** `StatementAutoLinkService` subscribes to the in-process event bus
  (`EventBus.subscribeAll`, new) and reacts to the `transaction.created` / `transaction.updated`
  events the transaction service already publishes post-commit — no circular module import, and
  receipt confirm / reconcile are covered for free. Fire-and-forget; the HTTP response never
  waits. It stands down for 60 s while a queue decision on that account has claimed a line whose
  transaction is not attached yet, so a brand-new transaction is never handed to a look-alike
  second line (not in the design text; unit-tested and commented).
- **Receipt confirm** gains an optional `accountId` (validated inside the confirm's transaction
  through `validateAccountPlacement` on the caller's client, so a bad account rolls the whole
  confirm back); the web confirm dialog offers a "Paid from" picker narrowed to the receipt's
  currency. Category memory (§5.4), plan-occurrence settle and the gap on cards and the dashboard
  had shipped with 20.3 – 20.5; the settle now has an integration test.
- Not exercised end to end: `DUE` (no code path produces it yet).

### Tests

api unit 1414 (95 suites) · integration `accounts-autolink` 5 (create → linked + POSTED + audit;
placed later by PATCH; two identical lines stay PENDING; archived-account confirm rolls back
then the real confirm links; occurrence settle) — `accounts*` + `receipts-confirm` 74 green ·
web `ReceiptConfirmDialog` 8.

## 20.7 — Connector: api tokens (2026-09-25)

Per design §3, §6.4 and `docs/ui/20.7-connector-tokens.md`. API side merged as `6fd15bf` (track
`p20/accounts-api`, six commits: `8c3848e` table + scope, `d6bef53` create / list / revoke,
`733bed6` the import-route guard, `cf9ff3c` integration, `83dc011` wiki, `1e69f3a` expiry rule).
Web settings page and the `apps/connector` CLI are on their own tracks (entries follow).

### Scope (API)

- **`api_tokens`** — migration `20260925130000_phase20_7_api_tokens` (additive; `migrate diff`
  clean): `tokenHash` unique (sha256 through the refresh-token hasher), `scopes` (one scope exists,
  `accounts:import`), `name`, `lastUsedAt`, `expiresAt`, `revokedAt`. Shared constants and types in
  `packages/shared/src/types/api-token.types.ts` (`API_TOKEN_PREFIX = 'mfp_'`, 40 url-safe random
  characters, `API_TOKEN_MAX_ACTIVE = 10`, `ApiTokenSummary`, `ApiTokenCreated`).
- **`/auth/tokens`** (JWT only — a token can never manage tokens): `POST` → 201 with the raw
  token exactly once (409 `API_TOKEN_LIMIT_REACHED` past ten active, 400
  `API_TOKEN_EXPIRY_INVALID` for a past expiry), `GET` → live tokens without secrets (expired ones
  listed with their `expiresAt` so the UI can label them), `DELETE /:id` → 204 (404 for unknown,
  revoked or another user's). Audit `API_TOKEN_CREATED` / `API_TOKEN_REVOKED` with scopes and
  expiry only; `lastUsedAt` stamped at most once a minute.
- **`JwtOrApiTokenGuard`** on `POST /accounts/:accountId/imports` only: JWT first, else an
  `mfp_` bearer with `accounts:import` (403 `API_TOKEN_SCOPE` otherwise, 401 for revoked, expired,
  unknown or a deactivated user). Every other route stays JWT-only — proven by the integration
  case that `GET /accounts` with a token is 401. `request.user` carries `tokenId` for audit.

### Scope (CLI) — merged as `1029f76` from `p20/connector`

- **`apps/connector`** (`@myfinpro/connector`, private, ESM, `bin: myfinpro-connector`) on
  `israeli-bank-scrapers` 6.12 (puppeteer 24; the browser is a documented one-time
  `npx puppeteer browsers install chrome`, never downloaded by `pnpm install`). Commands: `init`
  (prompts, secrets read with echo off, config written 0600 and refused when readable by others),
  `sync [--since] [--dry-run] [--profile]`, `accounts`, `doctor`. Exit codes 0 / 1 / 2 config / 3
  scrape / 4 API. Credentials live only in the user's config; nothing is logged; the server never
  sees a bank password — the safety property of design §3 is structural.
- **Mapper** (`src/map.ts`): `chargedAmount` moves money (sign → direction), `date` → `postedAt`,
  `processedDate` → `valueAt` when different, foreign pair only when the currencies differ,
  `identifier` → `externalId`, `category` → `categoryHint`, installments kept when consistent,
  pending lines imported as they are (the fingerprint dedups them when they post), skips reported
  by index and reason never by content, lines emitted oldest first so the ordinal fingerprint is
  reproducible. Sources mapped onto `ACCOUNT_IMPORT_SOURCES` (`visaCal → cal`, unknown →
  `connector`). Chunks of `ACCOUNT_IMPORT_MAX_LINES`; `periodFrom`/`periodTo` on every chunk, the
  scraped balance on the last one like the wizard (`0ee68a4`). The three import-line field caps
  moved into `packages/shared` so the CLI and the API cut to the same lengths (`24ee991`).
- Not verified: no real bank login was attempted (no browser on this machine); the token path is
  exercised only by the API integration suite. `npx @myfinpro/connector` as printed by the
  settings page needs the package published — the owner's call (README documents the in-repo
  invocation meanwhile).

### Tests (API)

api unit 1406 (95 suites; `ApiTokenService` 18, guard 6) · integration `auth-tokens` 8 +
`accounts-import*` 21 = 29 green (verified in the orchestrator's own run after the merge base) ·
connector 80 (6 files: mapper 30, config 20, client 16, companies 7, cli 4, scrape 3).
Security review of the token, settings and CLI tracks together: pending until all three are in.

## 20.4 — Statement parsing + import API (2026-09-25)

Per design §4.1, §5, §6.2. Merged as `6663b77` (track branch `p20/import-api`, eight commits). No
schema change.

### Scope

- **`packages/shared/src/statement/`** — one parser engine over `string[][]` with preset
  **data** for `hapoalim`, `leumi`, `discount`, `isracard`, `cal`, `max` and `generic_csv`
  (header aliases from the research notes, debit/credit vs signed vs charged/original
  conventions, totals and section skipping, multiple tables per sheet, billing date and card
  last-4 extraction, installment markers), `detectPreset`, manual column mapping,
  `normalizeDescription` shared with the API. Synthetic fixtures only.
- **Import API** — `POST /accounts/:id/imports` (10/min, owner or any member) validates ≤
  2000 lines, computes the per-account `fingerprint`, inserts atomically with duplicates
  counted (never errors), updates the reported balance when newer, then runs the matcher
  outside the insert transaction and stores each suggestion snapshot; `GET` imports and
  `GET /accounts/:id/lines` with `status` / `importId` / `suggestion` filters and the resolved
  `StatementSuggestionDto` (one batched lookup per page).
- **Matcher** (`matching/statement-matcher.ts`, pure) — exact amount gate, ±5-day window,
  trigram description similarity, same-account bonus, confident ≥ 0.8 with a 0.10 lead
  (epsilon-safe); card-bill → transfer proposal via `INSTITUTION_META.billTokens` and
  `billingAccountId`; `create` with the category remembered from earlier lines; `none` when
  look-alikes exist but none is confident.
- **Line decisions** — `match` (new `TransactionService.confirmByStatementLine`: sets the
  account when null, flips PENDING/DUE → POSTED, audits `reason: 'statement_match'`, accepts
  generated occurrences), `create` and `transfer` through `TransactionService.create`,
  `ignore`, `DELETE …/link` (back to PENDING, transaction untouched), `apply-suggestions`.
  Archived accounts refuse new decisions but allow `ignore`/unlink so a queue never sticks.
- Extracted, not copied: the transaction visibility predicate
  (`transaction/utils/transaction-visibility.ts`) and the account audit/event side effects
  (`account/utils/account-side-effects.ts`).

### Tests

shared 209 (14 files) · api unit 1377 (93 suites) · integration `accounts-import` (14) new;
`accounts-crud`, `transactions-accounts`, `analytics-query` green (71 across the four).

### Security review (2026-09-25)

Verdict on the first merge: fix first — one authenticated DoS (unmemoised trigram scoring over
the whole 500-candidate pool, ≈48 s of event-loop block for a hostile import), a member-level
write into the admin-only reported balance with an unbounded date, a double-apply race that
could create two transactions per line, an unmapped unique-violation on concurrent matches,
and a 100 KB body limit that made the documented 2000-line chunk unreachable; plus six low
findings. All closed in `5ce4973`: candidates are bucketed by direction/amount/currency with
trigram sets built once per import and at most 50 scored per line; every decision is a
conditional claim (`updateMany … status: 'PENDING'`) taken before any money write, P2002 →
409 `STATEMENT_LINE_ALREADY_LINKED`; a route-scoped JSON limit derived from the import
contract (`common/middleware/body-parsers.ts`, shared with the integration bootstrap);
`statementBalanceAt` bounded like line dates and equal-date corrections allowed; manual
matches gated on `ONE_TIME` + matchable status; category memory and suggestion categories
limited to what the actor can use; `apply-suggestions` capped at 200 with `remaining`;
fingerprint over the stable tuple only (no reference or running balance); invisible linked
transactions hide their id too; the sanitiser's character class rewritten as escapes so the
file is diffable. Integration: `accounts-import` (18) + `accounts-import-limits` (3, incl. a
full 2000-line chunk) + `accounts-crud` + `transactions-accounts` = 63 green; api unit 1381.

**Next** — 20.6 (two-way enrichment), then 20.7 connector + `api_tokens`, 20.8 alerts + release.
