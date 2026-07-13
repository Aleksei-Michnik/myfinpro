# Phase 8.13–8.16 — Receipt Intake & Payment Integration

> **Principle**: a receipt is a payment's proving document. The target model
> is **every receipt belongs to a payment** — a receipt without a payment has
> no use. Today the link appears only when a standalone receipt is confirmed
> (Phase 7.9); the iterations below widen the intake paths first and then
> close the orphan gap.

Increments ship in this order (8.14 immediately after 8.13 by request):

| Iter | Scope                                                               | Status  |
| ---- | ------------------------------------------------------------------- | ------- |
| 8.13 | Intake chooser in Add Payment: device upload + **Add from URL**     | shipped |
| 8.14 | Manual receipt via **barcode scanning** (camera, qty+price memory)  | planned |
| 8.15 | Attach receipts to **existing payments** + LLM reconciliation       | planned |
| 8.16 | Invariant: no receipt without a payment; directory mirrors payments | planned |

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

- "Attach receipt" action on a payment (row menu + details) → the same
  8.13 chooser (device / URL / barcodes).
- When extraction lands (realtime `receipt.updated`), a
  **reconciliation dialog** compares, per field, the payment's current
  value vs the receipt's extracted value — total and category — and the
  user picks keep-current or take-receipt for each. Item/product links
  (walkthrough, registry aliases, purchase history) are saved **regardless
  of the choices** — reconciliation only decides the payment header.
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
