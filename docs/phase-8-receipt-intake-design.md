# Phase 8.13–8.23 — Receipt Intake & Transaction Integration

> **Principle**: a receipt is a transaction's proving document. The target model
> is **every receipt belongs to a transaction** — a receipt without a transaction has
> no use. Today the link appears only when a standalone receipt is confirmed
> (Phase 7.9); the iterations below widen the intake paths first and then
> close the orphan gap.

Increments ship in this order (8.14 immediately after 8.13 by request):

| Iter | Scope                                                                        | Status  |
| ---- | ---------------------------------------------------------------------------- | ------- |
| 8.13 | Intake chooser in Add Transaction: device upload + **Add from URL**          | shipped |
| 8.14 | Manual receipt via **barcode scanning** (camera, qty+price memory)           | shipped |
| 8.15 | Attach receipts to **existing transactions** + LLM reconciliation            | shipped |
| 8.16 | Invariant: no receipt without a transaction; directory mirrors transactions  | planned |
| 8.17 | Online-receipt URL intake: provider adapters (SPA → JSON) + guards           | shipped |
| 8.18 | Receipt document viewer (image zoom/pan + PDF) + purchase-details fold       | shipped |
| 8.19 | Transaction Documents panel + cross-member receipt access + Transactions nav | shipped |
| 8.20 | Rename Payment → Transaction end-to-end (DB, API, web, docs)                 | shipped |
| 8.21 | Extraction hardening: model catalog, chunked continuation, printed barcodes  | shipped |
| 8.22 | Multi-photo receipts: one long slip photographed in ordered pages            | shipped |
| 8.23 | Printed-code-first matching UX + registry identity on review rows            | shipped |

8.17 jumped ahead of the still-planned 8.16: a user-reported bug (a real
online receipt imported blank) made the URL path a correctness fix, not a
nice-to-have. 8.18–8.19 likewise land ahead of 8.16 — UX follow-ups raised
while reviewing receipts on staging.

## 1. 8.13 — Intake chooser in Add Transaction

The "From receipt" strip in the Add Transaction dialog stops jumping straight
into a file picker. It becomes a small chooser of intake methods:

1. **Upload from this device** — the existing file input (photo/PDF).
2. **Add from URL** — inline URL form; e-receipt links from text messages
   are first-class (Phase 8.12 routes the fetched content by what it
   actually is: HTML → readable text, PDF/image → native vision inputs).
3. **Scan product barcodes** — added by 8.14 (absent until it ships; no
   disabled placeholder UI).

Both live options create the receipt and hand off to the unchanged
extract → review → confirm pipeline, which ends in the transaction.
Accessibility: real buttons with visible labels, the URL field is labelled
and Enter submits, errors surface via the existing toast + `aria-live`
conventions; all colors have dark-mode variants.

## 2. 8.14 — Manual receipt via barcode scanning

For purchases without a scannable/linkable receipt slip: compose the
receipt by scanning the products themselves.

**Flow** (`ManualReceiptDialog`, opened from the 8.13 chooser):

- Camera scanning reuses `BarcodeScannerDialog` (native `BarcodeDetector`,
  ZXing fallback, manual GTIN entry as the always-available AT path).
- Each scanned GTIN → `GET /products/barcode/:code`:
  - registry hit → line item added immediately;
  - miss → `ProductFormDialog` opens pre-filled (OFF prefill when
    available) to create the product, then the line is added.
- A line = product × **quantity** × **unit price** (integer cents; total =
  qty × price recomputed live). Quantity defaults to 1.
- **Price memory**:
  - same barcode scanned again in this dialog → the existing line's
    quantity increments (price already known);
  - across sessions → unit price prefills from the product's purchase
    history (`GET /products/:id/purchases`, `merchants[].lastUnitPriceCents`,
    most recent merchant first) when available.
- Header fields: currency (defaults to the user's `defaultCurrency`),
  optional merchant name, optional purchase date (defaults to now).

**API**: `POST /receipts/manual` — `{ currency, merchantName?, purchasedAt?,
items: [{ productId, quantity, unitPriceCents }] }` (≥1 item). Creates a
receipt with `source: 'manual'`, **status `REVIEW` immediately** (no
extraction job — the user IS the extractor), items pre-linked
(`productId`, `matchStatus: 'CONFIRMED'`, stage `barcode`, confidence 1.0,
`rawName` = product name), `totalCents` = Σ lines. Review → confirm then
creates the transaction exactly like any other receipt; purchase history and
the product registry update through the same code paths.

`RECEIPT_SOURCES` gains `'manual'`; retry-extraction is rejected for
manual receipts (nothing to extract).

## 3. 8.15 — Attach receipts to existing transactions + LLM reconciliation

**API**

- `POST /transactions/:id/receipt` (multipart file) and
  `POST /transactions/:id/receipt-url` `{ url }` — create a receipt with
  `transactionId` set **at creation** (expense transactions owned by the caller;
  one receipt per transaction — `receipts.transaction_id` is already unique;
  404-not-403 for foreign transactions). Extraction runs unchanged.
- `POST /receipts/:id/reconcile` `{ applyTotal: boolean, applyCategory:
boolean }` — the confirm step for attached receipts: flips REVIEW →
  CONFIRMED **without creating a transaction**, and per the flags updates the
  linked transaction's `amountCents`/`currency` and/or `categoryId` from the
  reviewed receipt. Audited (`RECEIPT_RECONCILED`, old → new values).

**Web**

- "Attach receipt" action on an expense transaction (row menu) →
  `AttachReceiptDialog`: **device upload / add-from-URL**. Only the two
  LLM-analysed paths are offered — a barcode-composed manual receipt has
  no extraction to reconcile against, so it stays a standalone-intake path.
- When extraction lands (the attached receipt reaches REVIEW), a
  **reconciliation dialog** auto-opens and compares, per field, the
  transaction's current value vs the receipt's extracted value — total and
  category (the receipt's dominant item category by spend) — and the user
  picks keep-current or take-receipt for each. Item/product links
  (walkthrough, registry aliases, purchase history) are saved **regardless
  of the choices** — reconciliation only decides the transaction header. The
  receipt review page swaps its Confirm action for Reconcile whenever the
  receipt carries a `transactionId`.
- Currency mismatch (receipt currency ≠ transaction currency) is surfaced as a
  warning; applying the total then also applies the receipt currency.

## 4. 8.16 — Invariant: no receipt without a transaction

Goal: the receipts directory mirrors transactions — every listed receipt shows
and links its transaction; orphan receipts stop existing as a durable state.

Pre-confirm receipts (UPLOADED/EXTRACTING/REVIEW/FAILED) still need to
exist while extraction runs. Two designs considered:

- **(a) Draft transactions at intake** — every new receipt immediately creates
  a `DRAFT` transaction that confirm fills in. Cost: a transaction status machine,
  draft filtering in every transaction list/summary/budget query.
- **(b) Transient intake, mirrored directory** _(recommended)_ — receipts
  in pre-confirm states are presented as an "intake in progress" strip,
  not as directory rows; the receipts directory lists confirmed receipts
  with their transaction (merchant, amount, transaction link, receipt thumbnail),
  i.e. exactly the transaction mirror. Enforcement: confirm/reconcile are the
  only exits from REVIEW; stale drafts (e.g. > 30 days) are surfaced for
  deletion. No transaction schema changes.

Decision (b) to be revisited when 8.16 starts; migration then reduces to a
UI/listing change plus a cleanup job — existing CONFIRMED receipts already
all carry `transactionId`.

## 5. 8.17 — Online-receipt URL intake: provider adapters + guards

**Why.** A real online receipt (a Pairzon e-receipt link) imported blank:
the review opened with nothing extracted. Root cause: the page is a
**client-side-rendered SPA**. The short link 302-redirects to an HTML
shell that carries no receipt data; the browser then loads it over XHR
from a JSON endpoint (`/v1.0/documents/<docId>?p=<prefix>`). Our
server-side fetch only ever saw the shell — reduced to a few hundred chars
of chrome ending in "Loading…" — so the model had nothing to read and the
receipt landed in REVIEW empty. A green test suite and a green deploy did
not catch it because no test exercised a real SPA receipt.

**Provider adapters.** URL resolution moves out of the worker into a
`ReceiptUrlIntakeService` fronted by a small **provider registry**. Each
adapter `matches(url)` a known host and `resolveContent(url, fetchSafe)`
returns the receipt as a compact **text snapshot** (or `null` to defer to
the generic path). The **Pairzon** adapter — Pairzon powers a large share
of Israeli retail e-receipts (Rami Levy, Keshet Teamim, …) — follows the
short-link redirect to learn `docId` + `prefix`, reads the JSON document,
and **reduces it** to merchant/date/currency/total + one line per item
(name, barcode, qty, unit, line total, discount). This is exactly what the
browser reads; **no headless browser is required**. New providers are one
small class + one registry entry.

The reduction is load-bearing, not cosmetic: the raw Pairzon document is
~30 KB (~21 K input tokens) of hashes, ids, loyalty data and per-item
category trees. Handing it verbatim to the model made it think over the
noise and hit the output-token ceiling, truncating the structured JSON
mid-array — surfacing as a "non-JSON output" parse failure (found in
staging verification, not by the test suite or the green deploy). The
adapter therefore strips the payload to the receipt essentials (~1.4 K
tokens for a 39-line receipt), and the shared extraction output cap was
raised (8192 → 16384) to give large grocery receipts headroom. The adapter
also deliberately drops the shopper's loyalty name, masked card and voucher
numbers from `notes` — that PII never reaches the model.

**Empty-result guard (provider-agnostic).** After extraction, an
all-empty result (no merchant, no positive total, no items) no longer
becomes a silent REVIEW. It fails fast with actionable guidance — for URL
receipts, "open the link and upload a screenshot or PDF instead". This is
the safety net for any SPA we haven't adapted yet and for unrelated/junk
links, independent of the provider layer.

**Guarding the data sources.** Receipt providers run their own abuse
defences; one user pasting many links (or several users hitting one
provider) must not get our egress IP blocked for everyone. So, across ALL
users, fetches to a single host are rate-limited within a short window
(DB-counted); over the limit is a **transient** back-off (BullMQ retries,
spreading load) rather than a failure. The existing SSRF guard still runs
at ingestion and again on **every redirect hop**, and the 10 MB cap still
applies.

**Anonymized analysis log.** Every attempt records one row in
`receipt_url_intakes`: `host`, the path **masked to its shape**
(id/token-like segments → `:token`, so `/1331/3s70…` → `/:token/:token`),
the matched provider (if any) and an `outcome`
(`provider_ok` / `fetched` / `binary_*` / `empty_result` / `throttled` /
…). Deliberately **user-unlinked and token-free**: enough to spot a
provider worth adapting when we see repeated `empty_result`s from one host,
without hoarding live receipt bearer-links or tying browsing to a user.

**Deferred — headless fallback for unknown SPAs.** Unknown providers
currently hit the empty-result guard (fail-fast with guidance). The
provider interface is the seam to later add a real renderer (headless
Chromium) for hosts we see often but can't reach via a data endpoint; the
anonymized log is what will tell us which hosts justify it.

## 6. 8.18 — Receipt document viewer + transaction purchase-details fold

Two UX follow-ups from reviewing receipts on staging.

**Document viewer (receipt review page).** `ReceiptDocumentViewer` — a
portal-mounted, focus-trapped dialog (the app's standard modal pattern:
ESC/backdrop close, focus snapshot+restore, Tab trap). Images support zoom
(buttons, wheel, `+`/`-`/`0`) and drag-to-pan; PDFs render in the browser's
native viewer with a download fallback. The review page's inline image opens
it on click; PDFs get a "view document" button. URL receipts keep their
external link (nothing to embed).

**Purchase-details fold (transaction view).** `TransactionPurchaseDetails` turns the
transaction's bare receipt link into an accessible disclosure
(`aria-expanded`/`aria-controls`) listing the receipt's products/services
(name + brand, qty × unit, line total in the transaction currency).

## 7. 8.19 — Transaction Documents panel, cross-member receipt access, navigation

A cluster of receipt↔transaction cohesion fixes raised on staging.

**Cross-member receipt access.** A receipt is a transaction's proving document,
so anyone who can see the transaction should be able to see (and open) that
document — not just the uploader. Receipt **reads** (`GET /receipts/:id`,
`GET /receipts/:id/file`) now resolve via a `loadViewableOrThrow` guard:
the uploader, OR any user the linked transaction is visible to (reusing
`TransactionService.assertVisible`, which already covers personal + group-member
attributions). **Mutations stay uploader-only** (`loadOwnedOrThrow`
unchanged) — a group member can view a shared transaction's receipt but not
edit/reconcile/delete it.

**Documents panel (transaction view).** The Phase-6.14 "coming in Phase 9"
placeholder is replaced by a real `TransactionDocuments` panel: it lists the
transaction's receipt as a document (file name + type, or the source URL) and
opens it in the 8.18 `ReceiptDocumentViewer` (reused verbatim). Phase 9 is
Purchase Analytics, not documents — the placeholder's promise was stale, and
the document already exists as the linked receipt.

**Navigation + backlink.** The full-featured `/transactions` list (built in 6.16)
was never linked from the sidebar — transactions were only reachable via the
dashboard. Add a **Transactions** nav item. And close the loop the other way: the
receipt review page gets a link to its **attributed transaction** when the
receipt carries a `transactionId`.

## 8. 8.20 — Rename Payment → Transaction end-to-end

"Payment" was the wrong umbrella term: the entity also models incomes and
(future) user-to-user transfers, so the product language is **Transaction**
(HE: תנועה). Renamed everywhere at once — half-renamed systems are the worst
of both worlds:

- **DB**: one hand-written migration renames 7 tables (`payments` →
  `transactions`, `payment_*` → `transaction_*`), every `payment_id` /
  `parent_payment_id` / `payments_count` column, every index and FK
  constraint name — pure renames, no data touched. Two uniques whose new
  default names would exceed MySQL's 64-char identifier limit are pinned via
  `map:` in the schema. Verified with `prisma migrate diff` = **zero drift**.
- **API**: module/routes (`/api/v1/transactions`), services, DTOs, error
  codes (`TRANSACTION_*`), audit actions, realtime events
  (`transaction.updated`, …), queue (`transaction-occurrences`) and scheduler
  ids. Because BullMQ **job schedulers live only in Redis keyed by queue
  name**, the rename adds an `onApplicationBootstrap` reconciliation that
  re-upserts every live schedule from the DB — which also permanently
  self-heals Redis loss (previously recurring schedules would silently die
  with a flushed Redis).
- **Web**: route `/transactions` (+ `[transactionId]`), contexts, components,
  testids, i18n keys AND values in both locales — the Hebrew pass rewrites
  gender agreement (תשלום is masculine, תנועה is feminine). Real-world
  payment senses stay ("repayment", "payment cards", the DUE status label
  לתשלום — about the act of paying, not the entity).
- **Docs**: living docs (design docs, conventions, plan) renamed —
  `phase-6-payments-design.md` → `phase-6-transactions-design.md`; the
  progress journal and RCA post-mortems stay as historical records (only
  link paths to the renamed file updated).

## 9. 8.21 — Extraction hardening + printed product codes

A production incident exposed two model-compatibility gaps and a missing
signal on receipt lines:

- **Curated model catalog.** The extraction call requires adaptive thinking +
  structured outputs (Anthropic) / strict `json_schema` (OpenAI); the shared
  `LLM_MODEL_CATALOG` now documents that bar and drops Claude Haiku 4.5,
  which 400s on adaptive thinking. Stored selections of removed models keep
  failing with the existing actionable settings message.
- **Chunked continuation.** A ~50-line receipt exceeded the output-token
  ceiling mid-JSON, surfacing as a misleading "non-JSON output". The ceiling
  moved to 64K (Anthropic streams — SDK guidance above 16K), and BOTH
  providers now treat a truncated pass as a chunk boundary: complete items
  are salvaged from the cut-off JSON with a string-aware brace scanner, and
  the model CONTINUES after the last captured line in a fresh call (bounded
  at 4 continuations; a no-progress pass fails permanently). No generated
  tokens are thrown away. 4xx provider rejections (except 429) map to
  permanent failures instead of burning resilience-layer retries.
- **Printed product codes.** Receipts print EAN/UPC digits next to lines;
  extraction returns them (`ExtractedItem.barcode`), the matcher gets a
  stage-1 exact-GTIN lookup (confidence 1.0, auto-links — same as manual
  scans), the GS1 checksum gates OCR misreads, `receipt_items.barcode`
  persists the normalized code, and a confirmed manual link backfills
  `Product.barcode` when the product has none and the code is unowned — the
  registry learns, and the next receipt auto-matches.

## 10. 8.22 — Multi-photo receipts

A very long paper slip cannot fit one photo. A receipt now owns ordered
pages in `receipt_files` (migration moves existing single files to page 1
and drops the receipts single-file columns):

- **Upload** takes 1–8 files: several images are the pages of ONE receipt in
  the given order; a PDF is always a single file (mixed batches 400 and
  clean up already-stored pages). Per-file validation (magic bytes,
  HEIC→JPEG, 10MB) is unchanged.
- **Extraction** reads all pages as one document — one image block per page,
  in order, with a prompt rule to treat overlapping seams as one receipt and
  extract each line exactly once.
- **Serving** moves to `GET /receipts/:id/files/:fileId` (same co-viewer
  authz as 8.19); confirm writes one transaction-document row per page.
- **Web.** Camera shots and multi-image picks stage as pages in a tray
  (thumbnails in shot order, per-page remove) with an explicit **one
  receipt** vs **separate receipts** choice; a single picked image uploads
  instantly as before. The document viewer gains an accessible page
  navigator (zoom/pan resets per page); attach-to-transaction accepts
  several photos.

## 11. 8.23 — Printed-code-first matching + registry identity on rows

8.21 taught the pipeline to extract printed codes, but the review UI never
showed them: the walkthrough proposed nothing for a code the registry didn't
own yet, and rows gave no hint a code was read. Matching an item whose code
is printed on the paper should be a confirmation, not a search:

- **Walkthrough, code-first.** The current item's printed code is shown and
  auto-looked-up (registry → Open Food Facts). A registry owner leads the
  candidate list at 100%; an OFF-only hit renders a one-click **Create &
  link** offer (name/brand/barcode/image from OFF, raw spelling recorded as
  alias) with an **Edit first…** escape into the create form. "New product"
  and the form itself now prefill and auto-resolve the code (the scan path
  previously discarded the OFF prefill until a manual field blur).
- **Save controls.** The single Confirm becomes **Save & stay / Save &
  close / Save & next** (Enter = save & next), so the dialog doubles as a
  one-item match editor.
- **Registry identity on rows.** `GET /receipts` items expose
  `productHasImage`/`productImageVersion`; each review row shows a clickable
  chip — official product name + thumbnail once matched, "Match product… ·
  code" until then — that opens the walkthrough dialog focused on that exact
  item (`initialItemId`).
