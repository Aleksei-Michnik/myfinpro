# Phase 8.24–8.26 — UX Follow-ups: Item Cards, Product Pictures, Extraction Transparency

> Requested 2026-07-17 (user feedback from staging use on a phone). Three
> follow-up iterations that close the biggest remaining UX gaps of the
> receipt pipeline: line items unusable on mobile, products limited to one
> invisible-by-default picture, and extraction being a black box between
> "Extracting…" and "Ready for review". Follows all Phase 6–8 conventions
> (structured error codes, audit logs, `useAsyncOperation`, EN+HE i18n,
> dark mode, RTL). 8.13–8.23 live in
> [`phase-8-receipt-intake-design.md`](phase-8-receipt-intake-design.md);
> this document starts a separate follow-up cluster with its own index.

| Iter | Scope                                                                            | Status  |
| ---- | -------------------------------------------------------------------------------- | ------- |
| 8.24 | Receipt review items as cards (mobile-first) with product thumbnails             | planned |
| 8.25 | Up to 5 pictures per product + WebP/AVIF rendition pipeline + receipt compaction | planned |
| 8.26 | Extraction transparency: staged live progress + streamed model thinking          | planned |

**Ordering.** 8.24 ships first because it is a pure web-layer change that
already works against the existing `GET /products/:id/image` endpoint (the
8.23 row thumbnails prove it); 8.25 then swaps a purpose-built thumbnail
rendition underneath without touching card markup — only the `imageUrl()`
helper learns a `size` argument. 8.26 is independent of both and can run in
parallel.

## 1. Overview & goals

- **8.24** — the review page renders line items as a `grid-cols-12` row per
  item. On a phone the row collapses into unusable slivers, and two extracted
  fields (unit price, line discount) are not rendered at all — `ItemRow`
  carries them and `save()` round-trips them, but the grid dropped them for
  horizontal space. One card per item fixes both: every field gets room, and
  the card carries the product thumbnail + match state introduced in 8.23.
- **8.25** — products hold a single `imageRef` (8.8). Users want to
  photograph a product from several angles and to add pictures right in the
  create dialog with the same camera UX receipts have. Storage-wise, both
  product images and confirmed receipt photos should be small: product
  images gain WebP **and** AVIF renditions plus a dedicated thumbnail;
  receipt image pages are re-encoded once extraction can never run again.
- **8.26** — while a receipt extracts, the user watches a static pill.
  The pipeline has real stages (resolve model → send → model thinks →
  output streams → continuation passes) and, on Anthropic models, a
  streamable reasoning summary. Surface them live — ephemerally, nothing
  persisted — through the existing EventBus → SSE stack, with an animated
  indicator that keeps moving even when no real signal arrives.

User stories served: receipt review/confirmation on mobile (Phase 7/8
stories), product catalog curation (Phase 8), and the general "the system
tells me what it is doing" trust stories behind the receipt pipeline.

## 2. 8.24 — Receipt items as cards

### 2.1 Decision: cards replace the table everywhere

One implementation, no breakpoint fork (DNA: minimal, no copy-paste). The
items column of the review page is half of a `lg:grid-cols-2` layout
(~480 px on desktop), so even on desktop the 12-column row is cramped — a
vertical card stack with an internal field grid reads better at every
width. The `grid-cols-12` row markup in
[`receipt-review-client.tsx`](../apps/web/src/app/%5Blocale%5D/receipts/%5BreceiptId%5D/receipt-review-client.tsx)
(the `items.map` block) is **removed**, not kept behind a media query.

### 2.2 `ReceiptItemCard`

New `apps/web/src/components/receipt/ReceiptItemCard.tsx`. Controlled,
presentational — state stays in the review client (`ItemRow` + `setItem`
unchanged). Props: `{ index, row: ItemRow, serverItem?: ReceiptItem,
editable, matchable, categories, currency, onChange(patch), onRemove(),
onOpenMatch(itemId) }`.

Card anatomy (logical properties throughout — RTL works for free):

- **Header row**: product thumbnail (inline-start, see §2.3) + the name
  input (flex-1) + remove button (inline-end, `editable` only). The 8.23
  match-status dot and the clickable registry chip (official name /
  "Match product… · code") sit under the name exactly as today and keep
  opening the walkthrough focused on the item (`onOpenMatch`).
- **Field grid**: `grid grid-cols-2 sm:grid-cols-4 gap-2` with labelled
  inputs for quantity, **unit price**, **discount**, line total — unit
  price and discount become visible/editable for the first time; both are
  advisory (line total stays authoritative; the existing totals-mismatch
  warning is untouched).
- **Category row**: the category select, full width.

Money fields keep the `parseMoney`/`centsToStr` string convention and the
existing `data-testid`s (`item-name-${index}`, `item-qty-${index}`,
`item-total-${index}`, `item-category-${index}`, `item-remove-${index}`,
`item-match-${index}`, `item-product-${index}`) so the current specs keep
meaning; new testids: `receipt-item-card-${index}`, `item-unit-${index}`,
`item-discount-${index}`.

The card stack replaces the `review-items` container content: one card per
row at every width (`space-y-2`). Add-item button and all save/confirm
gating are unchanged.

### 2.3 Thumbnail + reuse audit

- **`ProductThumb` is extracted** from `receipt-review-client.tsx` into
  `apps/web/src/components/product/ProductThumb.tsx` with a `sizeClass`
  prop (row chip keeps `h-5 w-5`; the card header uses `h-12 w-12`). It
  keeps its contract: registry image via `useProducts().imageUrl(...)`
  when `productHasImage`, the cube placeholder SVG otherwise or on load
  error. Unmatched items therefore show the placeholder — decided; no
  per-item photo exists before a product link, and inventing one would
  duplicate the registry.
- Until 8.25 lands, the thumbnail consumes the existing 512 px WebP from
  `GET /products/:id/image` (browser downscales — what 8.23 already does).
  8.25 §3.3 switches `imageUrl()` to the thumb rendition; card markup
  does not change.
- **`ReceiptConfirmDialog`** — audited: it renders category/scope/note
  only, **no item rows** — nothing to reuse.
- **`ItemWalkthroughDialog`** — audited: it renders a one-item summary
  header (raw name, qty × unit = total, printed code, linked chip), not an
  editable row. It does not adopt the card, but it **does** adopt the
  extracted `ProductThumb` next to its linked-product chip — one thumbnail
  implementation everywhere.
- **`TransactionPurchaseDetails`** (8.18 read-only fold) — optionally gains
  `ProductThumb` per line in the same pass (small, DRY); no card adoption.

### 2.4 i18n & accessibility

New keys under `receipts.review`: `itemUnitPrice`, `itemDiscount` (labels;
`itemQty`, `itemTotal`, `itemName` exist). Every input gets a visible
label inside the card (the old grid used `title`/`placeholder` only — an
a11y debt this pays down). EN + HE; HE strings checked for feminine
agreement with תנועה where sentences reference the transaction. No
RTL-specific work beyond logical properties.

### 2.5 Tests

Component specs: card renders all fields incl. unit price/discount; edits
propagate via `onChange`; match chip opens walkthrough with the item id;
placeholder vs image thumbnail; disabled state cascades when
`editable=false`. Review-client spec updated for the new markup; existing
walkthrough/confirm specs stay green.

## 3. 8.25 — Product pictures + image optimization pipeline

### 3.1 Data model

New table; `products.image_ref` is retired in the same iteration.

```prisma
// Phase 8.25 — up to 5 pictures per product; position 1 = the primary
// image (catalog cards, receipt-item thumbnails). Rendition files derive
// from base_ref: `<base>.webp`, `<base>.avif`, `<base>.thumb.webp`,
// `<base>.thumb.avif` under PRODUCT_IMAGE_STORAGE_DIR; rows are immutable
// except position.
model ProductImage {
  id        String  @id @default(uuid()) @db.VarChar(36)
  productId String  @map("product_id") @db.VarChar(36)
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  // 1-based display order; reorder renumbers contiguously in one tx.
  position  Int
  // Server-minted path stem (yyyy/mm/uuid) — never user input.
  baseRef   String  @map("base_ref") @db.VarChar(500)

  createdAt DateTime @default(now()) @map("created_at")

  @@unique([productId, position])
  @@map("product_images")
}
```

Index note (plan §3.3): the `(product_id, position)` unique covers the only
query shape (`WHERE product_id = ? ORDER BY position`) via its leftmost
prefix — no extra index.

**Migration — expand, then contract, one iteration.** Two migrations:

1. **Expand**: create `product_images`; backfill one row per product with
   a non-null `image_ref` (`position = 1`, `base_ref` = `image_ref` minus
   the `.webp` suffix — the existing detail WebP already sits at
   `<base>.webp`, so backfilled rows are immediately servable). Old code
   reading `products.image_ref` keeps working through the blue-green
   switchover.
2. **Contract**: drop `products.image_ref` after the code cutover commit —
   DNA "never leave legacy code"; the column would otherwise rot as a
   stale duplicate of position-1 rows.

Backfilled rows lack AVIF + thumbnail files; the serving endpoint treats
renditions as best-effort (§3.3), and a one-shot backfill job (§3.4)
regenerates the missing renditions from the stored 512 px WebP (originals
were deleted at 8.8 processing time — a 96 px thumb from a 512 px source is
fine).

Shared constants (`packages/shared/src/types/product.types.ts`):
`PRODUCT_IMAGE_MAX_COUNT = 5` (reused by API validation and the dialog);
`PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES` unchanged.

### 3.2 Renditions

All produced by the existing BullMQ worker with sharp (^0.35 encodes AVIF);
`rotate()` bakes EXIF orientation and re-encoding drops all metadata, as
today.

| Rendition | File                | Longest edge | Quality | Purpose                           |
| --------- | ------------------- | -----------: | ------: | --------------------------------- |
| detail    | `<base>.webp`       |       512 px |    q 82 | product detail/dialog (fallback)  |
| detail    | `<base>.avif`       |       512 px |    q 50 | product detail/dialog (preferred) |
| thumb     | `<base>.thumb.webp` |        96 px |    q 75 | cards, rows, pickers (fallback)   |
| thumb     | `<base>.thumb.avif` |        96 px |    q 45 | cards, rows, pickers (preferred)  |

96 px covers the largest thumbnail consumer (8.24's 48 px card thumb) at
2× DPR. "Moderate definition" per request — product pictures are
recognition aids, not receipt-grade documents. AVIF is generated
best-effort: if encoding fails (libheif missing in some future base
image), the job logs and continues with WebP only; serving degrades
gracefully.

### 3.3 API design

Existing single-image endpoints generalize; nothing else changes shape.

- `POST /products/:id/images` (multipart `file`) — appends at the next
  position. 400 `PRODUCT_IMAGE_LIMIT_REACHED` at
  `PRODUCT_IMAGE_MAX_COUNT`; validation (size cap, magic-byte sniff via
  `ReceiptStorageService.detectMimeType`, PDF rejection) exactly as the
  current `enqueueUpload`. Returns 202 + the created row (renditions land
  async, as today). Replaces `POST /products/:id/image` (removed — its
  only web caller moves).
- `DELETE /products/:id/images/:imageId` — removes row + all four
  rendition files; remaining rows renumber contiguously.
- `PATCH /products/:id/images/:imageId` `{ position }` — reorder
  (transactional renumber, same pattern as receipt-items `PUT`);
  position 1 defines the primary image.
- `GET /products/:id/image?size=full|thumb` — **kept** as the
  primary-image shortcut so every existing consumer (`ProductCard`,
  `ProductThumb`, walkthrough) needs no URL change; serves the
  position-1 image. `size` defaults to `full`.
- `GET /products/:id/images/:imageId?size=full|thumb` — a specific image
  (detail gallery).

**Format negotiation (decided): server-side `Accept` negotiation, not
`<picture>`.** If the request's `Accept` contains `image/avif` and the
AVIF rendition file exists (fs stat), serve it; otherwise the WebP.
Response carries `Content-Type` accordingly, `Vary: Accept`, and an ETag
of `<baseRef basename>.<size>.<format>` with the existing long-lived
caching. Rationale: `<picture>`/`srcset` would fork every `<img>` call
site and the `imageUrl()` helper into per-format URLs; negotiation keeps
one URL per (image, size) and one code path — all evergreen browsers send
`image/avif` in `Accept` when supported. Recorded trade-off: `Vary:
Accept` fragments the browser cache per Accept string, harmless for a
private, per-user API.

DTOs: product responses keep `imageVersion` (now derived from the primary
row's `baseRef` basename — the `productImageVersion()` helper reads the
new source; receipt-item DTO fields `productHasImage` /
`productImageVersion` are unchanged in shape). Product detail adds
`images: { id, position, version }[]`. Audit actions:
`PRODUCT_IMAGE_ADDED` / `PRODUCT_IMAGE_REMOVED` / `PRODUCT_IMAGE_REORDERED`.

Web `imageUrl()` (product-context) gains an optional `size` argument
(`'full' | 'thumb'`, default `'full'`) appended as the query param;
`ProductThumb` passes `'thumb'`. Cache-busting `?v=` stays.

### 3.4 Worker changes

`ProductImageJob` gains the target row id: `{ productImageId, kind:
'staged' | 'url', ... }`. The processor writes the four renditions to
`<base>.*`, then updates the row (or deletes staged input / replaced files
exactly as today — the swap-and-clean logic generalizes from "the one
imageRef" to "this row's rendition set"). A vanished product **or row** is
a no-op. The OFF-prefill URL fetch path (`enqueueUrlFetch`, create-time
`imageUrl`) now creates the position-1 `ProductImage` row instead of
setting `imageRef`.

**Rendition backfill**: an idempotent `backfill-renditions` job enqueued
from `onApplicationBootstrap` (same self-healing pattern as the 8.20
scheduler reconciliation): scan `product_images` rows whose
`<base>.thumb.webp` is missing, enqueue per-row regeneration from
`<base>.webp`, rate-limited. Safe to re-run; disappears as a no-op once
backfilled.

### 3.5 Web: shared capture primitive + "Add picture"

**`FileCaptureButtons`** — new `apps/web/src/components/ui/`
primitive extracted from `ReceiptUploadZone`: the _browse_ + _camera_
button pair with their two hidden inputs (`accept`, `multiple`,
`capture="environment"` on the camera input), props `{ accept, multiple,
disabled, onFiles(files, source: 'picker' | 'camera'), browseLabel,
cameraLabel }`. Per DNA, the mechanism is extracted, not copied:

- `ReceiptUploadZone` refactors onto it (its own hidden inputs are
  deleted; the drag-and-drop zone and URL form stay local).
- `AttachReceiptDialog` adopts it (today it duplicates a hidden file
  input and has **no** camera path — it gains one for free).
- `ProductFormDialog` adds it as the **Add picture** control.

**`ProductFormDialog` pictures strip**: a horizontal strip of existing
picture thumbs (edit mode: server images via `imageUrl(..., 'thumb')`;
create mode: local `URL.createObjectURL` previews) each with a remove
button, plus `FileCaptureButtons` while under `PRODUCT_IMAGE_MAX_COUNT`.

- _Edit mode_: add → `POST /products/:id/images` immediately (control-scope
  `useAsyncOperation`); remove → `DELETE`; first thumb marked primary,
  drag-free reordering deferred (a "make primary" affordance = `PATCH
position: 1`).
- _Create mode_: files stage client-side (`File[]` state) and upload
  sequentially after `createProduct` returns the id, inside the same
  control-scope op — the dialog's single save spinner covers both. OFF
  image prefill behavior is unchanged and counts toward the 5-slot cap.

Product catalog/detail surfaces read the primary image exactly as before;
the detail page may render the strip read-only (position order).

### 3.6 Receipt storage compaction

Receipts are currently stored as uploaded (phone JPEGs, 2–5 MB × up to 8
pages). Constraint: extraction quality must not degrade.

**Decision — optimize only after CONFIRMED.** The status machine
guarantees extraction never runs again from CONFIRMED (retry exists only
for FAILED → UPLOADED; REVIEW re-extraction does not exist), so the
original is model-grade for its whole extraction-relevant life. The
rejected alternative — optimize at upload and keep a model-grade copy
until confirm — doubles storage and adds a second file lifecycle for no
user-visible gain. FAILED/REVIEW receipts keep originals (8.16's
stale-draft cleanup remains their exit).

Mechanics — new `receipt-optimizations` BullMQ queue + processor:

- Enqueued from the two REVIEW → CONFIRMED choke points in
  `ReceiptService` (confirm and reconcile), payload `{ receiptId }`.
- For each `receipt_files` page with `mimeType` `image/jpeg`/`image/png`:
  sharp `rotate()` → resize ≤ 2048 px longest edge → WebP q 80. 2048 px
  keeps the document comfortably legible under the viewer's zoom — it
  remains the transaction's proving document. PDFs and already-WebP pages
  are skipped; a result not smaller than the original is discarded
  (keep-original guard).
- The new file is written under a fresh fileRef; the `receipt_files` row
  (`fileRef`, `mimeType`, `sizeBytes`) **and every `transaction_documents`
  row sharing the old `fileRef`** update in one transaction (confirm
  copies the receipt's fileRefs onto transaction-document rows — both
  references must move together); the original is then best-effort
  deleted. `image/webp` is already in `RECEIPT_ALLOWED_MIME_TYPES`, so no
  DTO/type changes.
- Privacy bonus recorded: re-encoding strips EXIF/GPS from receipt photos,
  which today are stored with full phone metadata.
- **Backfill**: the same bootstrap-enqueued idempotent sweep pattern as
  §3.4 — scan CONFIRMED receipts for jpeg/png pages, enqueue per-receipt
  jobs, rate-limited.

### 3.7 Security & limits

All product-image endpoints stay behind auth; refs remain server-minted
with the existing traversal guard. Upload endpoint throttled (30/min per
user — camera bursts fit, scripted abuse does not). The 5-image cap is
enforced server-side (not just in the dialog). Receipt compaction adds no
endpoint; it only touches files the receipt already owns. Audit rows as
§3.3; compaction logs sizes only, never content.

### 3.8 Tests

Unit: rendition suffix helpers, negotiation (Accept parsing + fs
fallback), keep-original guard, cap enforcement. Integration: upload →
worker → four files + row; delete renumbers; reorder swaps primary +
`imageVersion`; migration backfill (imageRef → row) asserted;
confirm/reconcile enqueue compaction; compaction updates `receipt_files` +
`transaction_documents` atomically and extraction fixtures still pass
untouched (originals never re-encoded pre-confirm). Web specs:
`FileCaptureButtons` (both sources), dialog strip in create + edit modes,
`ReceiptUploadZone`/`AttachReceiptDialog` refactors keep existing specs
green.

## 4. 8.26 — Extraction transparency

### 4.1 Event contract (ephemeral by construction)

New transient realtime event — **never persisted**: the EventBus is
in-memory, the event feeds no DTO, no DB column, no audit row, and thought
text is never logged.

`packages/shared/src/types/receipt.types.ts`:

```ts
export const RECEIPT_EXTRACTION_STAGES = [
  'preparing', // worker: reading pages / resolving the URL
  'sending', // provider resolved; request about to open
  'processing', // request open, no tokens yet
  'thinking', // reasoning-summary deltas arriving (capability-gated)
  'generating', // output tokens arriving
  'continuing', // chunked continuation pass (8.21)
] as const;
export type ReceiptExtractionStage = (typeof RECEIPT_EXTRACTION_STAGES)[number];

export interface ReceiptExtractionProgress {
  stage: ReceiptExtractionStage;
  /** Resolved provider/model — null on the deployment-default binding. */
  provider: string | null;
  model: string | null;
  /** New reasoning-summary text since the last event (throttled, capped). */
  thought?: string;
  /** Line items observed in the output stream so far. */
  itemsSoFar?: number;
  /** 1-based continuation pass (stage 'continuing'). */
  pass?: number;
}
```

Both union files gain (mirrored in the same iteration, per the registry
rule in `realtime-types.ts`):

```ts
| { type: 'receipt.extraction.progress'; userIds: string[];
    receiptId: string; progress: ReceiptExtractionProgress }
```

Recipients: the uploader only (`userIds: [uploadedById]`) — same privacy
stance as `receipt.updated`. `RealtimeFilter`/`eventMatches` gain a
`receiptId` criterion (one field, same pattern as `transactionId`). The
client resolves the model's display label from the shared
`findLlmModel(provider, model)?.label` — no new label plumbing; an
unresolved/default binding renders a generic "AI model" string.

### 4.2 Emission pipeline

`ExtractionContext` gains an optional callback — the context already flows
worker → resilient wrapper → provider, so no new plumbing layer:

```ts
onProgress?: (p: Omit<ReceiptExtractionProgress, 'provider' | 'model'>) => void;
```

The **processor** builds the callback: it decorates with
receiptId/userIds/provider/model (it owns `resolved`), **throttles** to at
most one event per ~300 ms (trailing edge, thoughts concatenated), caps
`thought` at ~400 chars per event, and publishes via the existing
`EventBus`. It also emits `preparing` before `buildInput()` and `sending`
right after resolution. Providers call `ctx.onProgress` best-effort;
absence of the callback (tests, other callers) is a no-op. The resilient
wrapper passes the context through untouched; on a retry the stage
sequence simply restarts — the UI treats every event as the current truth
(idempotent, per realtime conventions).

### 4.3 Provider changes — best-effort per capability

**Anthropic** (already streaming via `client.messages.stream()`):

- The thinking config becomes `{ type: 'adaptive', display: 'summarized' }`.
  On every catalog Anthropic model (Fable 5, Sonnet 5, Opus 4.8) the
  default display is `omitted` — thinking blocks stream with **empty**
  text — so without this opt-in there is no thought stream to show.
  `display` changes visibility only (thinking happens and is billed the
  same either way).
- Instead of only awaiting `finalMessage()`, the provider subscribes to
  the stream's `content_block_delta` events: `thinking_delta` →
  `onProgress({ stage: 'thinking', thought: delta })`; `text_delta` →
  `onProgress({ stage: 'generating', itemsSoFar })` where `itemsSoFar` is
  a cheap running count of `"rawName"` occurrences in the accumulated
  output. `processing` fires once when the stream opens. Continuation
  passes emit `continuing` with the pass number (real signal — already
  computed for the 8.21 chunking). `finalMessage()` and everything after
  it (salvage, validation, error mapping) is unchanged.

**OpenAI** (raw chat-completions fetch, currently non-streaming):

- The call moves to `stream: true` + `stream_options: { include_usage:
true }` with an SSE line parser: content deltas accumulate into what is
  today `message.content`; the final chunk carries `finish_reason`, the
  usage chunk feeds the existing log line. Deltas drive
  `generating`/`itemsSoFar` exactly like Anthropic. Refusal and
  error/4xx mapping semantics are preserved.
- **No `thinking` stage**: reasoning summaries are not exposed on the
  chat-completions surface for the catalog GPT-5.x models — recorded as a
  per-provider capability, not worked around. The UI falls back to the
  animated generic states (§4.4). Moving this provider to the Responses
  API is noted in §7, out of scope here.

**Mock provider**: emits a short scripted stage sequence so web/dev/E2E
can exercise the UI deterministically.

### 4.4 Web UI

New `apps/web/src/components/receipt/ExtractionActivity.tsx`, rendered
wherever the user waits on UPLOADED/EXTRACTING (both surfaces already
subscribe to `receipt.updated`, so mounting is a status check):

- **Review page** (`variant="panel"`) — the primary wait surface: 7.13/8.13
  intake redirects to `/receipts/:id` immediately after upload. The panel
  replaces the empty items area while `status ∈ {UPLOADED, EXTRACTING}`:
  animated indicator + stage line ("Sending to Anthropic Claude Opus 4.8…",
  "Model is thinking…", "Reading line items… 12 so far", "Continuing —
  pass 2…"), a one-line **thought ticker** showing the latest reasoning
  line, and an accessible disclosure ("Show the model's reasoning",
  `aria-expanded`) that expands the full accumulated thought text in a
  scrollable region. The accumulation lives in component state only —
  reload forgets it, by design.
- **Receipts list rows** (`variant="inline"`) — a compact rotating-verb
  line next to the existing `ReceiptStatusPill` on EXTRACTING rows.
- Subscription: `useRealtimeEvents({ type: 'receipt.extraction.progress',
receiptId }, …)`. No `useAsyncOperation` — this is a push stream, not a
  fetch; the surrounding surfaces keep their existing ops.
- **Always-moving indicator**: a shimmer/pulse dot plus client-side
  rotation through per-stage generic verb sets (~2.5 s interval) whenever
  no fresh event has arrived; real events preempt the rotation.
  `prefers-reduced-motion`: shimmer and ticker fade are disabled (static
  dot, hard text swaps) — texts still update, matching the async-conventions
  a11y mandate. Live region: `role="status"` / `aria-live="polite"` on the
  stage line only (not per thought delta — too chatty for AT).
- The SSE channel is advisory (conventions): a receipt that flips straight
  to REVIEW without any progress events just shows the generic states
  until `receipt.updated` lands — no correctness dependency.

i18n: new `receipts.extraction` namespace — stage verbs (several per stage
for rotation), `sendingTo` (with `{model}`), `itemsSoFar` (ICU plural),
`showThoughts` / `hideThoughts`. EN + HE; HE reviewed for RTL punctuation
and gender (המודל חושב…).

### 4.5 Security

No new endpoints; events ride the authenticated per-user SSE stream and go
to the uploader only. Thought text is the model's commentary on the user's
own receipt — same sensitivity class as `rawExtraction`, but unlike it,
never stored. Emission adds no provider-key material to events or logs.

### 4.6 Tests

Unit: throttler (coalescing, trailing edge, cap), `itemsSoFar` counter,
SSE parser for the OpenAI provider (fixture stream incl. usage + length
finish), Anthropic delta wiring with a stubbed stream. Processor
integration: mock provider script → ordered EventBus publications with
receiptId/userIds; no progress events after terminal states. Web specs:
panel renders stages, ticker + disclosure accumulate, reduced-motion
branch, inline variant on list rows, model label resolution via the shared
catalog.

## 5. Iteration plan

| Iteration | Objective                   | Scope                                                                                                                                                                                                                                                                                     | Testing            | CI/CD                          | Deployment | Acceptance criteria                                                                                                                                                                                                                                                                               |
| --------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.24      | Receipt items as cards      | `ReceiptItemCard` replaces the review grid rows everywhere; unit price + discount editable; `ProductThumb` extracted + reused (walkthrough, purchase-details fold); labels on every field; i18n EN+HE                                                                                     | UI tests           | lint + typecheck + unit        | Deploy     | On a phone-width viewport every item field (name, qty, unit price, discount, total, category, match chip, thumbnail) is visible and editable with no horizontal scrolling; desktop renders the same cards; existing specs green                                                                   |
| 8.25      | Product pictures + pipeline | `product_images` (≤5/product, expand backfill + contract drop of `image_ref`); WebP+AVIF detail + thumb renditions; Accept-negotiated serving (`Vary: Accept`); `FileCaptureButtons` extraction + Add picture in `ProductFormDialog`; receipt image compaction post-CONFIRM (+ backfills) | Unit + integration | lint + typecheck + integration | Deploy     | A product created in the dialog carries camera/picker pictures (≤5, first = primary); AVIF served to supporting browsers with WebP fallback; 8.24 thumbnails consume the thumb rendition; confirmed receipts' image pages shrink with extraction untouched; `products.image_ref` no longer exists |
| 8.26      | Extraction progress UX      | `receipt.extraction.progress` SSE event (shared type + both unions, `receiptId` filter); `onProgress` through `ExtractionContext`; Anthropic summarized-thinking deltas, OpenAI SSE streaming; `ExtractionActivity` panel + inline variants; i18n EN+HE                                   | Unit + UI tests    | lint + typecheck + unit        | Deploy     | While a receipt extracts, the review page shows live staged progress incl. the model's name and a thought stream with an expandable full view when the provider yields one; providers without a reasoning stream degrade to animated generic states; nothing is persisted; reduced-motion honored |

Each iteration is independently shippable; 8.24 before 8.25 is a soft
dependency only (§Ordering above); 8.26 touches disjoint files and can run
in parallel with either.

## 6. Dependencies & contracts

**Consumes**

- 8.8 product-image worker/storage (extended in place), 8.22 `receipt_files`
  pages, 8.23 row-chip UX + `productHasImage`/`productImageVersion` DTO
  fields, 8.11 model resolution (`ExtractionResolverService`,
  `LLM_MODEL_CATALOG` labels), 6.18.1.4 EventBus/SSE stack, 8.21 chunked
  continuation (pass numbers become `continuing` events).

**Exposes to later phases**

- `product_images` + thumb rendition + `imageUrl(product, size)` — any
  surface needing product pictures (Phase 9 price-dynamics charts, Phase 13
  mini app) consumes `GET /products/:id/image?size=thumb` and the
  `images[]` DTO.
- `FileCaptureButtons` — the single capture primitive for future intake
  surfaces (Phase 13 mini app upload, avatars).
- `receipt.extraction.progress` — Phase 14 bot receipts can translate the
  same events into Telegram "typing"/status updates; Phase 19 (LLM usage
  tracking) may reuse the per-pass hooks for live token counters.
- The compaction queue pattern (post-terminal media optimization) is
  reusable for any future stored-document type.

## 7. Open questions

1. **AVIF encode cost** — AVIF at q45–50 is CPU-heavy on the single-core
   worker (hundreds of ms per image). Acceptable at this traffic; if a
   backfill sweep proves painful, cap backfill concurrency (queue limiter)
   rather than dropping the format. Measure on staging during 8.25.
2. **OpenAI reasoning stream** — surfacing GPT-5.x reasoning summaries
   requires migrating the provider to the Responses API (and provider-side
   eligibility for summaries). Deferred; the design's capability-gated
   `thinking` stage absorbs it later without contract changes.
3. **Receipt compaction quality bar** — 2048 px / q80 WebP is chosen for
   document legibility; if staging review shows fine print suffering on
   dense slips, raise to 2560 px before enabling the backfill sweep (the
   per-receipt job parameters are constants, not per-row state).
4. **Gallery on the product detail page** — 8.25 ships the strip in the
   form dialog and primary-image consumption everywhere; a swipeable
   gallery on `/products/:id` is deliberately left to a future polish
   iteration to keep 8.25 shippable.
