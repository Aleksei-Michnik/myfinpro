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
