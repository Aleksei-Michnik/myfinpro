# Phase 7: Receipt Ingestion & LLM Extraction — Design Document

> **Status**: Active (kickoff 2026-07-04)
> **Plan**: [`IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md) §5 — Phase 7 (re-plan of 2026-07-03; replaces the original OCR-based Phase 9 and absorbs old 15.8)
> **Depends on**: Phase 6 (Transaction entity, attributions, categories, TransactionDocument, BullMQ, realtime SSE stack)
> **Feeds**: Phase 8 (product catalog & matching), Phase 9 (purchase analytics), Phase 11 (MCP receipt upload), Phase 14 (bot receipts)

## 1. Overview

Users upload a receipt (photo, PDF, or URL). A **vision-LLM extraction
pipeline** pulls out the merchant ("place"), purchase date/time, currency,
and every line item (name, quantity, unit price, applied discounts, line
total). The user reviews and corrects the extraction, then confirms — which
creates a regular Phase-6 `Transaction` (direction `OUT`) carrying the receipt
file as a `TransactionDocument` and the line items as first-class rows for
later product matching (Phase 8) and analytics (Phase 9).

### User stories covered

- Upload a photo / PDF / URL of a receipt → expense extracted automatically.
- Extraction captures merchant, date/time, items, quantities, discounts, prices.
- Items classified into the user's **existing** categories, correctable at review.
- Purchases build toward the product DB (items persist as rows Phase 8 will match).

### Explicitly deferred

| Concern                                                    | Where                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| Product matching / walkthrough / barcode                   | Phase 8 (adds `receipt_items.product_id`)             |
| Configurable analytics over items                          | Phase 9                                               |
| Receipt upload via chat (MCP) / Telegram bot               | Phase 11 / Phase 14 (same pipeline, new entry points) |
| Multi-receipt per transaction, receipt for IN transactions | Out of scope — one receipt = one OUT transaction      |

## 2. Core Concepts

### 2.1 Receipt lifecycle

```
UPLOADED ──(worker picks job)──▶ EXTRACTING ──ok──▶ REVIEW ──user──▶ CONFIRMED
                                     │
                                     └─fail (after retries)──▶ FAILED ──retry──▶ EXTRACTING
```

- `UPLOADED` — file persisted, extraction job enqueued.
- `EXTRACTING` — worker owns it; transition is idempotent (status guard).
- `REVIEW` — parsed fields + items persisted; user edits freely.
- `CONFIRMED` — terminal; `transactionId` set. Items frozen (Phase 8 matching
  operates on confirmed items).
- `FAILED` — terminal-ish; carries `failureReason`; `POST /receipts/:id/retry`
  re-enqueues.

Deleting a receipt is allowed in any non-confirmed state (removes file +
rows). Confirmed receipts are deleted only via their transaction (Phase 6
delete semantics), which nulls `receipts.transaction_id` (SetNull) and returns
the receipt to `REVIEW`… **no** — kept simple: deleting the transaction
cascades a `receipts.transaction_id → SetNull`, the receipt stays `CONFIRMED`
as an audit artifact and can be re-confirmed. (Cheap, avoids a special
state.)

### 2.2 One receipt → one transaction

Confirming creates ONE `Transaction` (`direction=OUT`, `type=ONE_TIME`,
`occurredAt = purchasedAt`, `amountCents = totalCents`) with the user's
chosen attributions (remembered scopes, same UX as the transaction form), plus
a `TransactionDocument` (`kind='receipt'`, `fileRef` pointing at the SAME
stored file — no duplication). The transaction's category is the user-picked
primary (e.g. Groceries); item-level categories live on `receipt_items`.

### 2.3 Merchants — global registry

`merchants` is a global, append-mostly registry (the Phase-8 products
pattern, lite): `name` + unique `normalizedName` (lowercased, collapsed
whitespace, diacritics stripped). Extraction output is fuzzy-matched
against it at review time (`GET /merchants?search=`); confirming either
links an existing merchant or creates one. No per-user merchant data in
this phase.

### 2.4 Per-item categories

The extraction call receives the user's visible category list (system +
personal + group, direction OUT) and returns a suggested `categoryId` per
item (nullable). Review lets the user fix each. The API validates that
every confirmed item category is visible to the user and direction-compatible
(`OUT` or `BOTH`).

### 2.5 Extraction provider abstraction

```ts
interface ReceiptExtractionProvider {
  readonly name: string; // 'anthropic' | 'openai' | 'gemini' | 'mock'
  extract(input: ExtractionInput, ctx: ExtractionContext): Promise<ExtractionResult>;
}
```

- **Selected by env** `RECEIPT_EXTRACTION_PROVIDER` (default `mock`), model
  via `RECEIPT_EXTRACTION_MODEL`, keys via provider-specific env vars.
- `mock` is a deterministic fixture provider (no network) — powers dev,
  CI, and integration tests at zero cost.
- Implementations MUST return `ExtractionResult` matching the shared JSON
  schema (`packages/shared`), using the provider's native structured-output
  mechanism. Money is integer cents; quantity is a decimal number.
- Wrapped in the standard retry (3 attempts, exponential backoff) +
  circuit-breaker pattern; every call logs `{provider, model, durationMs,
inputBytes, usage?}` for cost tracking.

### 2.6 Realtime

New SSE event `receipt.updated { receipt }` published on every status
transition (recipient: the uploader only — receipts are private until
confirmed; the confirm flow's transaction fan-out reuses the Phase 6
`transaction.created` event). Views follow `docs/ui-realtime-conventions.md`
(advisory events + refetch on `resyncToken`).

## 3. Database Schema

```prisma
model Merchant {
  id             String   @id @default(uuid()) @db.VarChar(36)
  name           String   @db.VarChar(200)
  normalizedName String   @unique @map("normalized_name") @db.VarChar(200)
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  receipts Receipt[]

  @@map("merchants")
}

model Receipt {
  id            String    @id @default(uuid()) @db.VarChar(36)
  status        String    @default("UPLOADED") @db.VarChar(20)
  source        String    @default("upload") @db.VarChar(20) // upload | url
  // File (nullable for source=url until the fetcher stores a snapshot)
  fileRef       String?   @map("file_ref") @db.VarChar(500)
  originalName  String?   @map("original_name") @db.VarChar(255)
  mimeType      String?   @map("mime_type") @db.VarChar(100)
  sizeBytes     Int?      @map("size_bytes")
  sourceUrl     String?   @map("source_url") @db.VarChar(2000)
  // Extracted header (nullable until REVIEW)
  merchantId    String?   @map("merchant_id") @db.VarChar(36)
  merchant      Merchant? @relation(...)
  extractedMerchantName String? @map("extracted_merchant_name") @db.VarChar(200)
  purchasedAt   DateTime? @map("purchased_at")
  currency      String?   @db.VarChar(3)
  totalCents    Int?      @map("total_cents")
  discountCents Int?      @map("discount_cents") // receipt-level discounts
  rawExtraction Json?     @map("raw_extraction")
  failureReason String?   @map("failure_reason") @db.VarChar(500)
  // Ownership + linkage
  uploadedById  String    @map("uploaded_by_id") @db.VarChar(36)
  transactionId     String?   @unique @map("transaction_id") @db.VarChar(36) // SetNull on transaction delete
  createdAt / updatedAt

  items ReceiptItem[]

  @@index([uploadedById, status])
  @@index([merchantId])
  @@map("receipts")
}

model ReceiptItem {
  id            String  @id @default(uuid()) @db.VarChar(36)
  receiptId     String  @map("receipt_id") // Cascade
  position      Int     // 1-based order on the receipt
  rawName       String  @map("raw_name") @db.VarChar(300)
  quantity      Decimal @default(1) @db.Decimal(10, 3)
  unitPriceCents Int?   @map("unit_price_cents")
  discountCents Int     @default(0) @map("discount_cents")
  totalCents    Int     @map("total_cents") // after discount
  categoryId    String? @map("category_id") // suggested/confirmed; NoAction
  createdAt / updatedAt

  @@unique([receiptId, position])
  @@index([categoryId])
  @@map("receipt_items")
}
```

Expand-only migration; `receipt_items.product_id` arrives in Phase 8.
The invariant `Σ items.totalCents − receipt.discountCents ≈ totalCents` is
validated as a **warning flag** (`totalsMismatch` in responses), never a
hard block — real receipts contain rounding, deposits, and tips.

## 4. API Design

All under `/api/v1`, JWT-guarded, throttled. Receipts are visible to their
uploader only (until Phase 11 widens reads for MCP).

| Method | Endpoint                | Purpose                                                                                      |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------- |
| POST   | `/receipts`             | multipart upload (`file`) → row (UPLOADED) + job. 10 MB, MIME whitelist                      |
| POST   | `/receipts/url`         | `{ url }` → row (`source=url`, UPLOADED) + job                                               |
| GET    | `/receipts`             | cursor list, filter `?status=`                                                               |
| GET    | `/receipts/:id`         | full receipt incl. items                                                                     |
| GET    | `/receipts/:id/file`    | stream the stored file (uploader only)                                                       |
| PATCH  | `/receipts/:id`         | REVIEW-only header edits (merchant fields, purchasedAt, currency, totals)                    |
| PUT    | `/receipts/:id/items`   | REVIEW-only full items replace (positions renumbered)                                        |
| POST   | `/receipts/:id/retry`   | FAILED → re-enqueue                                                                          |
| POST   | `/receipts/:id/confirm` | REVIEW → CONFIRMED: creates merchant?, Transaction, TransactionDocument; links transactionId |
| DELETE | `/receipts/:id`         | non-confirmed only: remove file + rows                                                       |
| GET    | `/merchants?search=`    | registry search (normalized contains + trigram-lite ordering)                                |

**Confirm body**: `{ merchantId? | merchantName?, purchasedAt, currency,
totalCents, categoryId, attributions: AttributionScope[], note? }` — items
are taken from the current `receipt_items` rows (edit them first via PUT).
Confirm validates like `POST /transactions` (currency list, category
direction/visibility, attribution scopes) and runs in one transaction.

**Error codes** (`RECEIPT_*`): `RECEIPT_NOT_FOUND`, `RECEIPT_INVALID_STATE`,
`RECEIPT_INVALID_FILE_TYPE`, `RECEIPT_FILE_TOO_LARGE`, `RECEIPT_INVALID_URL`,
`RECEIPT_EXTRACTION_FAILED`, `RECEIPT_ALREADY_CONFIRMED`,
`RECEIPT_ITEMS_INVALID`, `MERCHANT_NOT_FOUND`.

**Audit matrix** (every lifecycle transition writes one row; all fire-and-
forget so an audit failure never breaks the operation). Entity is `Receipt`
unless noted:

| Action                      | Trigger                                 | Entity   | Details                                              |
| --------------------------- | --------------------------------------- | -------- | ---------------------------------------------------- |
| `RECEIPT_UPLOADED`          | `POST /receipts` / `POST /receipts/url` | Receipt  | `{mimeType, sizeBytes}` or `{sourceUrl}`             |
| `RECEIPT_EXTRACTED`         | worker → REVIEW                         | Receipt  | `{provider, items, confidence}`                      |
| `RECEIPT_EXTRACTION_FAILED` | worker terminal failure → FAILED        | Receipt  | `{provider, permanent, reason}`                      |
| `RECEIPT_RETRIED`           | `POST /receipts/:id/retry`              | Receipt  | `{}`                                                 |
| `RECEIPT_UPDATED`           | `PATCH /receipts/:id`                   | Receipt  | `{changed: [field…]}`                                |
| `RECEIPT_ITEMS_REPLACED`    | `PUT /receipts/:id/items`               | Receipt  | `{items: count}`                                     |
| `RECEIPT_CONFIRMED`         | `POST /receipts/:id/confirm`            | Receipt  | `{transactionId, amountCents, currency, merchantId}` |
| `MERCHANT_CREATED`          | confirm registers a new merchant        | Merchant | `{name}`                                             |
| `RECEIPT_DELETED`           | `DELETE /receipts/:id`                  | Receipt  | `{status}`                                           |

Note: confirmation does **not** write a separate `TRANSACTION_CREATED` audit —
`RECEIPT_CONFIRMED` records the new `transactionId`, and the transaction is still
announced live via the Phase 6 `transaction.created` realtime event. (The
standalone `POST /transactions` path keeps its own `TRANSACTION_CREATED` audit.)

## 5. File Storage

- Root from `RECEIPT_STORAGE_DIR` (default `<repo>/storage/receipts` in dev,
  a mounted volume in Docker) — **outside the web root**; served only via
  the authenticated endpoint.
- Layout `receipts/<yyyy>/<mm>/<uuid>.<ext>`; extension derived from the
  **detected** MIME (magic bytes via file-type sniffing), never from the
  client filename.
- Whitelist: `image/jpeg`, `image/png`, `image/webp`, `image/heic`,
  `application/pdf`. 10 MB cap (multer limits + DTO).
- Deletion is best-effort (log on failure); DB row is the source of truth.

## 6. Extraction Pipeline

### 6.1 Queue

`RECEIPT_EXTRACTIONS_QUEUE`, job `{ receiptId }`, `attempts: 3`,
exponential backoff, `jobId = receipt:<id>:<attemptEpoch>` — the status
guard (`UPLOADED|FAILED → EXTRACTING`) makes re-fires no-ops.

### 6.2 Worker

1. Load receipt; skip unless status ∈ {UPLOADED, FAILED, EXTRACTING-stale}.
2. Set `EXTRACTING`; publish `receipt.updated`.
3. Read file (or fetch URL → HTML/text snapshot for `source=url`).
4. Load the uploader's OUT-visible categories → `ExtractionContext`.
5. `provider.extract(...)` → validate against the shared JSON schema
   (zod-style structural check) → normalize money to cents.
6. Transaction: update header fields + `rawExtraction`, replace items,
   status `REVIEW`.
7. Publish `receipt.updated`; audit `RECEIPT_EXTRACTED`.
8. On terminal failure: status `FAILED` + `failureReason`; publish + audit.

### 6.3 ExtractionResult (shared schema, abridged)

```ts
interface ExtractionResult {
  merchantName: string | null;
  purchasedAt: string | null; // ISO 8601
  currency: string | null; // ISO 4217 guess
  totalCents: number | null;
  discountCents: number | null; // receipt-level
  items: Array<{
    rawName: string;
    quantity: number; // decimal ok
    unitPriceCents: number | null;
    discountCents: number; // line-level
    totalCents: number;
    suggestedCategoryId: string | null; // from the provided candidate list ONLY
  }>;
  confidence: 'high' | 'medium' | 'low';
  notes: string | null; // provider free-text caveats
}
```

## 7. Frontend Design

- **`/receipts`** — upload page: drag-and-drop + `<input capture>` for
  mobile camera, URL form, list of the user's receipts with live status
  pills (SSE `receipt.updated` + `resyncToken` refetch).
- **`/receipts/[receiptId]`** — review page: file preview (image/PDF
  object) side-by-side with editable header (merchant autocomplete from
  `/merchants?search=`, date/time, currency, totals incl. mismatch
  warning) and an editable items table (name, qty, unit price, discount,
  total, category select). Actions: Save (PATCH/PUT), Confirm (scope
  multiselect w/ `remember.ts`, primary category), Retry (FAILED),
  Delete.
- Confirmed receipts deep-link to the transaction detail page; the transaction
  detail page's documents section lists the receipt file (replaces the
  Phase 6 placeholder for these transactions).
- i18n namespace `receipts.*` in EN + HE from the start; dark-mode variants
  on every surface (Phase 6 conventions).

## 8. Iteration Plan (7.1 – 7.10)

Matches [`IMPLEMENTATION-PLAN.md`](../IMPLEMENTATION-PLAN.md) Phase 7 table:

| It.  | Scope (delta)                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------- |
| 7.1  | `packages/shared`: `RECEIPT_STATUSES`, `ExtractionResult` schema + validator, receipt DTA types                         |
| 7.2  | Prisma models + expand-only migration; prisma-models spec                                                               |
| 7.3  | `ReceiptStorageService`: save/read/delete, magic-byte MIME detection, whitelist, path layout                            |
| 7.4  | `POST /receipts` + `/receipts/url` + list/get/delete + file streaming; BullMQ producer; realtime event type             |
| 7.5  | Provider layer: interface, mock provider, Anthropic + OpenAI implementations behind env config, retry/breaker, cost log |
| 7.6  | Extraction worker (queue consumer) + status machine + items persistence                                                 |
| 7.7  | `/receipts` upload UI (drag-drop, camera, URL, live list)                                                               |
| 7.8  | Review page (header + items editing, merchant autocomplete)                                                             |
| 7.9  | Confirm flow → transaction + document; transaction detail receipt link                                                  |
| 7.10 | URL ingestion polish, audit matrix, integration + Playwright E2E, i18n sweep                                            |

Each iteration ships with unit/integration tests, i18n keys where UI is
touched, CI-green push, and a progress-notes entry — Phase 6 cadence.
