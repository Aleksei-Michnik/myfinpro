# Phase 8.13–8.17 — Receipt Intake & Payment Integration

> **Principle**: a receipt is a payment's proving document. The target model
> is **every receipt belongs to a payment** — a receipt without a payment has
> no use. Today the link appears only when a standalone receipt is confirmed
> (Phase 7.9); the iterations below widen the intake paths first and then
> close the orphan gap.

Increments ship in this order (8.14 immediately after 8.13 by request):

| Iter | Scope                                                               | Status  |
| ---- | ------------------------------------------------------------------- | ------- |
| 8.13 | Intake chooser in Add Payment: device upload + **Add from URL**     | shipped |
| 8.14 | Manual receipt via **barcode scanning** (camera, qty+price memory)  | shipped |
| 8.15 | Attach receipts to **existing payments** + LLM reconciliation       | shipped |
| 8.16 | Invariant: no receipt without a payment; directory mirrors payments | planned |
| 8.17 | Online-receipt URL intake: provider adapters (SPA → JSON) + guards  | shipped |

8.17 jumped ahead of the still-planned 8.16: a user-reported bug (a real
online receipt imported blank) made the URL path a correctness fix, not a
nice-to-have.

## 1. 8.13 — Intake chooser in Add Payment

The "From receipt" strip in the Add Payment dialog stops jumping straight
into a file picker. It becomes a small chooser of intake methods:

1. **Upload from this device** — the existing file input (photo/PDF).
2. **Add from URL** — inline URL form; e-receipt links from text messages
   are first-class (Phase 8.12 routes the fetched content by what it
   actually is: HTML → readable text, PDF/image → native vision inputs).
3. **Scan product barcodes** — added by 8.14 (absent until it ships; no
   disabled placeholder UI).

Both live options create the receipt and hand off to the unchanged
extract → review → confirm pipeline, which ends in the payment.
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
creates the payment exactly like any other receipt; purchase history and
the product registry update through the same code paths.

`RECEIPT_SOURCES` gains `'manual'`; retry-extraction is rejected for
manual receipts (nothing to extract).

## 3. 8.15 — Attach receipts to existing payments + LLM reconciliation

**API**

- `POST /payments/:id/receipt` (multipart file) and
  `POST /payments/:id/receipt-url` `{ url }` — create a receipt with
  `paymentId` set **at creation** (expense payments owned by the caller;
  one receipt per payment — `receipts.payment_id` is already unique;
  404-not-403 for foreign payments). Extraction runs unchanged.
- `POST /receipts/:id/reconcile` `{ applyTotal: boolean, applyCategory:
boolean }` — the confirm step for attached receipts: flips REVIEW →
  CONFIRMED **without creating a payment**, and per the flags updates the
  linked payment's `amountCents`/`currency` and/or `categoryId` from the
  reviewed receipt. Audited (`RECEIPT_RECONCILED`, old → new values).

**Web**

- "Attach receipt" action on an expense payment (row menu) →
  `AttachReceiptDialog`: **device upload / add-from-URL**. Only the two
  LLM-analysed paths are offered — a barcode-composed manual receipt has
  no extraction to reconcile against, so it stays a standalone-intake path.
- When extraction lands (the attached receipt reaches REVIEW), a
  **reconciliation dialog** auto-opens and compares, per field, the
  payment's current value vs the receipt's extracted value — total and
  category (the receipt's dominant item category by spend) — and the user
  picks keep-current or take-receipt for each. Item/product links
  (walkthrough, registry aliases, purchase history) are saved **regardless
  of the choices** — reconciliation only decides the payment header. The
  receipt review page swaps its Confirm action for Reconcile whenever the
  receipt carries a `paymentId`.
- Currency mismatch (receipt currency ≠ payment currency) is surfaced as a
  warning; applying the total then also applies the receipt currency.

## 4. 8.16 — Invariant: no receipt without a payment

Goal: the receipts directory mirrors payments — every listed receipt shows
and links its payment; orphan receipts stop existing as a durable state.

Pre-confirm receipts (UPLOADED/EXTRACTING/REVIEW/FAILED) still need to
exist while extraction runs. Two designs considered:

- **(a) Draft payments at intake** — every new receipt immediately creates
  a `DRAFT` payment that confirm fills in. Cost: a payment status machine,
  draft filtering in every payment list/summary/budget query.
- **(b) Transient intake, mirrored directory** _(recommended)_ — receipts
  in pre-confirm states are presented as an "intake in progress" strip,
  not as directory rows; the receipts directory lists confirmed receipts
  with their payment (merchant, amount, payment link, receipt thumbnail),
  i.e. exactly the payment mirror. Enforcement: confirm/reconcile are the
  only exits from REVIEW; stale drafts (e.g. > 30 days) are surfaced for
  deletion. No payment schema changes.

Decision (b) to be revisited when 8.16 starts; migration then reduces to a
UI/listing change plus a cleanup job — existing CONFIRMED receipts already
all carry `paymentId`.

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
