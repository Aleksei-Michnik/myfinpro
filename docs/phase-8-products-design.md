# Phase 8 — Product Catalog, Matching & Barcode

> Kickoff 2026-07-11. Implements the two-layer product database from
> `IMPLEMENTATION-PLAN.md` §Phase 8: a **global product registry** shared by
> all users plus **private purchase data** derived from each user's confirmed
> receipts. Builds directly on Phase 7 (`receipts`, `receipt_items`,
> `merchants`) and follows all Phase 6/7 conventions (structured error codes,
> cursor pagination, audit logs, `useAsyncOperation`, EN+HE i18n, dark mode).

## 1. Concepts

### 1.1 Two layers

- **Global registry** (`products`, `product_aliases`): barcode (GTIN) as the
  primary identifier when known, one canonical name + brand, one image, a
  default OUT category, and multi-language aliases. Any authenticated user
  can search it and contribute to it; it grows organically as receipts are
  confirmed. Mirrors the Phase 7 `merchants` registry model.
- **Private purchase data**: `receipt_items.product_id` links a user's
  receipt lines to registry products. Purchase history, price statistics and
  the "my products" catalog are **always scoped to the caller's own
  receipts** — the registry never leaks who bought what.

### 1.2 Staged matching (design §8.3)

For every extracted line item the worker runs a deterministic staged
matcher, cheapest stage first:

| #   | Stage     | Rule                                                    | Confidence |
| --- | --------- | ------------------------------------------------------- | ---------- |
| 1   | `barcode` | exact GTIN hit (walkthrough scan / structured receipts) | 1.0        |
| 2   | `alias`   | `normalize(rawName)` equals a confirmed alias           | 0.95 + ε   |
| 3   | `exact`   | `normalize(rawName)` equals a product's normalized name | 0.9        |
| 4   | `fuzzy`   | trigram (Dice) similarity over a token-prefiltered pool | 0.35–0.85  |
| 5   | `llm`     | `suggestedProductId` picked by the extraction LLM       | 0.5–0.8    |

Normalization is the shared `normalizeLookupName` rule (lowercase,
whitespace-collapse, diacritics-strip) — the same key the merchant registry
uses. Trigram similarity runs in application code (MySQL has no `pg_trgm`);
the candidate pool is prefiltered with indexed `LIKE` lookups on the longest
name tokens and capped, so the scan never grows with registry size.

**LLM ranking in the same extraction call**: the worker injects a compact
product-candidate list (the uploader's recently purchased products, capped)
into the extraction prompt; the provider returns `suggestedProductId` per
item. This is what makes cross-language matches (`חלב` ↔ `Milk 3%`) work —
the deterministic stages cannot bridge languages, the LLM can. Ids outside
the injected list are dropped (same rule as `suggestedCategoryId`).

Stage results are merged per item (best confidence per product), stored on
the item as `match_candidates` JSON, and:

- top candidate from a **deterministic** stage (`barcode`/`alias`/`exact`)
  with confidence ≥ **0.9** → the item is **auto-linked**
  (`product_id` set, `match_status = 'AUTO'`) — this is the 8.5 acceptance
  ("second upload auto-matches items confirmed the first time");
- anything else → `match_status = 'PENDING'` with proposals for the
  walkthrough.

### 1.3 Walkthrough (design §8.4)

`match_status` lifecycle per receipt item:

```
PENDING ──confirm──▶ CONFIRMED
   │  ▲                  ▲
   │  └──── skip ──▶ SKIPPED (resumable — confirm still allowed)
AUTO ─────confirm────────┘        (auto-links may be re-pointed)
```

Confirming records the item's `rawName` as an alias (with the confirmer's
locale) via upsert: new alias rows start at `confirmation_count = 1`,
existing ones bump the counter — future alias-stage matches get slightly
higher confidence. Confirm may also override the item's category, and the
product's `default_category_id` backfills item categories the extraction
left empty. Walkthrough is allowed in `REVIEW` **and** `CONFIRMED` receipts
(matching after transaction creation is still valuable — price history counts
only confirmed receipts).

### 1.4 Barcode & Open Food Facts

- Scanning is client-side: `getUserMedia` + native `BarcodeDetector` where
  available, `@zxing/browser` fallback (lazy-loaded). Used to attach a
  barcode to a product and to scan-to-find during the walkthrough/catalog.
- `GET /products/barcode/:code` resolves locally first; unknown codes go to
  the Open Food Facts API (name/brand/image prefill for the create form)
  behind a circuit breaker + client-side rate limit. OFF being down degrades
  to manual entry — never an error the user has to care about.

### 1.5 Product images (design §8.8)

One image per product. Uploads are accepted raw (JPEG/PNG/WebP/HEIC, magic
bytes checked, ≤ 10MB), staged to disk and processed in the background
(BullMQ `product-images` queue): sharp re-encodes to WebP, longest edge
512px, metadata (EXIF/GPS) stripped by re-encode. OFF prefill images ride
the same queue as a `fetch-url` job (https only, size-capped). Serving is
`GET /products/:id/image` with strong ETag (the immutable `image_ref`) →
`304` on revalidation.

## 2. Schema (8.1, expand-only)

```prisma
model Product {
  id                String   @id @default(uuid())
  barcode           String?  @unique            // GTIN-8/12/13/14, checksum-validated
  name              String                      // canonical display name
  normalizedName    String                      // indexed lookup key
  brand             String?
  imageRef          String?                     // processed WebP under storage/products
  defaultCategoryId String?                     // OUT category, SetNull on delete
  aliases           ProductAlias[]
  receiptItems      ReceiptItem[]
  @@index([normalizedName])
}

model ProductAlias {
  productId         String   // Cascade
  name              String
  normalizedName    String
  locale            String?  // BCP-47 of the confirmer
  source            String   // 'confirmation' | 'manual' | 'extraction' | 'off'
  confirmationCount Int      @default(1)
  @@unique([productId, normalizedName])
  @@index([normalizedName])
}

model ReceiptItem {                             // additions
  productId       String?   // SetNull
  matchStatus     String    @default("PENDING") // PENDING|AUTO|CONFIRMED|SKIPPED
  matchCandidates Json?     // [{productId,name,brand,stage,confidence}]
  purchasedAt     DateTime? // denormalized from the receipt header
  @@index([productId, purchasedAt])
}
```

`receipt_items.purchased_at` is denormalized on purpose: the Phase 9 price
queries (`product × merchant × date × unit price`) hit the
`(product_id, purchased_at)` index without joining `receipts` for the date.
It is written by the extraction worker, kept in sync by the header PATCH /
items PUT paths, and stamped with the transaction date on confirm.

## 3. API surface (8.2, 8.4–8.8)

All endpoints JWT-guarded + throttled; errors are structured
`{ message, errorCode }` with `PRODUCT_*` codes.

| Method | Path                                     | Notes                                                                                                                      |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/products`                              | no `search`: caller's purchased products (stats, cursor-paginated); with `search`: ranked global registry matches (top 20) |
| GET    | `/products/:id`                          | registry row + aliases + caller-scoped purchase stats                                                                      |
| GET    | `/products/:id/purchases`                | caller's confirmed purchase rows + per-merchant price aggregates                                                           |
| POST   | `/products`                              | create (name, brand?, barcode?, defaultCategoryId?) → seeds a `manual` alias                                               |
| PATCH  | `/products/:id`                          | update; `barcode: null` detaches                                                                                           |
| POST   | `/products/:id/aliases`                  | add/confirm an alias (upsert on `(productId, normalizedName)`)                                                             |
| GET    | `/products/barcode/:code`                | local hit → product; miss → OFF prefill / `unavailable` / `disabled`                                                       |
| POST   | `/products/:id/image`                    | multipart; stages + enqueues; 202-style response `{ queued: true }`                                                        |
| GET    | `/products/:id/image`                    | processed WebP stream, ETag/304, immutable cache                                                                           |
| POST   | `/receipts/:id/items/:itemId/match`      | confirm: `{ productId }` xor `{ createProduct }`, optional `categoryId`                                                    |
| POST   | `/receipts/:id/items/:itemId/skip-match` | mark SKIPPED (resumable)                                                                                                   |

Registry writes are audited (`PRODUCT_CREATED`, `PRODUCT_UPDATED`,
`PRODUCT_ALIAS_RECORDED`, `RECEIPT_ITEM_MATCHED`) with the acting user.

## 4. Module layout

```
apps/api/src/product/
  product.module.ts            # imported by ReceiptModule (matcher + walkthrough)
  product.controller.ts
  product.service.ts           # registry CRUD + private stats/purchases
  product-matching.service.ts  # staged matcher + LLM-candidate feed
  open-food-facts.service.ts   # breaker + rate-limited OFF client
  product-image.service.ts     # staging, worker processing via sharp, serving
  product-image.processor.ts   # BullMQ consumer (product-images queue)
  constants/product-errors.ts
  dto/…                        # create/update/list/alias/match/barcode DTOs
  utils/trigram.util.ts        # dependency-free Dice trigram similarity
  utils/gtin.util.ts           # GTIN checksum validation + normalization
```

Shared package: `product.types.ts` (match statuses/stages, candidate shape,
`normalizeLookupName`, GTIN regex) used by both workspaces;
`ExtractedItem.suggestedProductId` added to the extraction contract +
validator (backward-compatible: missing → `null`).

## 5. Web UI (8.4, 8.6, 8.9)

- `/products` — catalog: debounced registry search, "my products" grid
  (image, brand, name, times-purchased, last unit price), barcode
  scan-to-find, create dialog with OFF prefill. Empty/loading/error states
  per `docs/ui-async-conventions.md`.
- `/products/:id` — detail: image (upload), names/aliases with locale tags,
  barcode (scan to attach), default category, purchase history table and
  per-merchant price summary (caller's data only).
- **Walkthrough** on the receipt review page: full-screen-on-mobile dialog
  stepping through items; per item the proposal + ranked candidates with
  confidence meters, registry search, create-new (barcode/OFF aware), skip.
  Keyboard-first: `Enter` confirm, `↑/↓` choose candidate, `S` skip, `N`
  new product, `←/→` navigate, `Esc` close (progress is server-persisted,
  so closing mid-way is always safe). `aria-live` step announcements, focus
  trapped in the dialog, `prefers-reduced-motion` respected.
- Barcode scanner dialog: camera preview + native `BarcodeDetector`,
  `@zxing/browser` dynamic-imported fallback, torch-free minimal UI, full
  keyboard/AT labelling; camera permission denial renders a manual-entry
  input instead of an error dead-end.

## 6. Performance notes

- Matching is batch-first: one alias query + one product query + one
  LIKE-prefiltered fuzzy pool per receipt (not per item); similarity runs
  in-process on ≤ ~600 pooled rows.
- Catalog/purchases aggregates use `groupBy` on the
  `(product_id, purchased_at)` index — no N+1, no `receipts` join for dates.
- Registry search: indexed equality first, bounded contains scan second,
  in-process rank; hard caps everywhere.
- Images: single background re-encode to 512px WebP (~10–30KB), immutable
  ETag caching, zero work on the hot path.
- Web: `@zxing/browser` and the scanner load via `next/dynamic` only when
  opened; walkthrough state updates are per-item PATCHes (no full-receipt
  refetch churn); search debounced at 300ms with AbortSignal reuse.

## 7. Out of scope (later phases)

- Price-history charts and analytics dashboards — Phase 9 (the indexes and
  `purchases` endpoint land here).
- Product merge/dedup tooling and moderation of the global registry.
- Multiple images per product; image variants.
