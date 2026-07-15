# Phase 7 — Receipt Ingestion & LLM Extraction

_Kickoff: 2026-07-04._

**Design doc**: [`docs/phase-7-receipts-design.md`](phase-7-receipts-design.md)
— lifecycle (`UPLOADED → EXTRACTING → REVIEW → CONFIRMED` / retryable
`FAILED`), one-receipt-one-payment, global merchants registry, pluggable
vision-LLM provider abstraction (env-selected, deterministic `mock` for
dev/CI), uploader-private visibility, advisory (never blocking) totals
validation.

## 7.1 — shared types (`53b0e5f`-ish, see log)

`RECEIPT_STATUSES` / sources / MIME whitelist (10MB), `ExtractionResult` +
`ExtractedItem` contracts, dependency-free structural validator with
per-path errors + normalization (the worker gate for LLM output), and
`computeTotalsMismatch`. 31 vitest cases; shared suite 99.

## 7.2 — schema

`merchants` (unique `normalized_name`), `receipts` (lifecycle columns,
nullable file + extracted header, `raw_extraction` JSON, cascade
`uploaded_by`, unique `payment_id` SetNull — deleting the payment leaves a
confirmed receipt as an audit artifact), `receipt_items` (unique
`(receipt_id, position)`, decimal quantity, line discounts, SetNull
category; `product_id` lands in Phase 8). Diff-generated expand-only
migration `20260704150000`, applied to dev; relations wired into User /
Payment / Category; prisma-models compile spec.

## 7.3 — file storage

`ReceiptStorageService`: `RECEIPT_STORAGE_DIR` root outside the web root,
`yyyy/mm/<uuid>.<ext>` layout, MAGIC-BYTE type detection (JPEG / PNG /
WebP / HEIC-family / PDF — client filename + content type advisory only),
structured 400s for oversize/non-whitelisted, streamed reads, best-effort
idempotent deletes, and a traversal guard on ref resolution. 15 cases
against a temp dir.

## 7.4 — ingestion API + producer

`ReceiptModule` REST surface (upload / url / list / get / file / retry /
delete; uploader-private, 404-no-leak), `RECEIPT_EXTRACTIONS_QUEUE`
producer (attempts 3, exponential backoff, timestamped job ids so retries
re-fire; the 7.6 worker's status guard makes duplicates no-ops), realtime
`receipt.updated` / `receipt.deleted` events (uploader-only fan-out),
audit actions. Service (13) + controller (5) specs.

**api suite: 904 green**; typecheck + lint clean; every iteration pushed
CI-green with staging deploys.

**Next** — 7.5 (extraction provider layer: mock + Anthropic + OpenAI
implementations behind `RECEIPT_EXTRACTION_PROVIDER`), 7.6 (worker).

## 7.5 — pluggable provider layer

`ReceiptExtractionProvider` contract (image / pdf / html inputs; category
candidates + locale in context) bound to a DI token by an env-selected
factory (`RECEIPT_EXTRACTION_PROVIDER`, unknown names fail the boot):

- **mock** (default) — deterministic reconciling fixture; zero network for
  dev/CI/integration.
- **anthropic** — `@anthropic-ai/sdk`: base64 `image`/`document` blocks
  before the instruction text, adaptive thinking, `output_config`
  json_schema structured output, per-call usage/cost logging. Default model
  `claude-opus-4-8` (override via `RECEIPT_EXTRACTION_MODEL`).
- **openai** — raw-HTTP chat completions (`image_url` data-URLs + strict
  `response_format` json_schema); PDFs fail permanently with a pointer to
  the anthropic provider.

Both real providers re-validate output with the shared
`validateExtractionResult` — schema drift becomes a permanent
`ExtractionFailedError`, never bad rows. `ResilientExtractionProvider`
wraps them: 3 attempts + exponential backoff for transient errors, no
retry for permanent ones, consecutive-failure circuit breaker
(open → fail fast → half-open probe). 14-case spec incl. the mocked
Anthropic request shape.

## 7.6 — extraction worker

`ReceiptExtractionProcessor` (BullMQ consumer) owns the status machine:
UPLOADED/EXTRACTING → REVIEW (header + `raw_extraction` + items replaced
with 1-based positions, suggested category ids filtered against the
uploader's visible OUT candidates) or → FAILED. URL sources fetch a
snapshot (20 s timeout, 500 KB cap; dead links permanent, 5xx transient).
Permanent failures are swallowed (no wasted BullMQ retries); transient
ones ride attempts/backoff and mark FAILED on the last attempt. Every
transition publishes `receipt.updated` + audit rows. 8-case spec.

**Deferred (documented):** HEIC→JPEG conversion before provider calls
(whitelisted for upload, but vision APIs take JPEG/PNG/WebP — convert in a
follow-up or fail with a clear reason); end-to-end pipeline integration
spec lands with 7.10.

**api suite: 926 green**; every push CI-green with staging deploys.

**Next** — 7.7 (upload UI), 7.8 (review UI), 7.9 (confirm → payment),
7.10 (URL polish + integration/E2E + i18n sweep).

---

## 7.7 — Receipts upload UI (2026-07-04)

**`/receipts`** (new sidebar entry): intake via drag-and-drop, file browse,
mobile camera capture (`capture="environment"`), and a URL form; the
uploader's receipt list renders lifecycle status pills (EXTRACTING pulses),
merchant/total/item-count once extracted, failure reasons with Retry on
FAILED rows, two-step Delete on non-confirmed rows, and cursor-paginated
Load more. Live lifecycle: `receipt.updated` patches rows in place /
prepends unknown ids, `receipt.deleted` removes, reconnect-after-gap
refetches (ui-realtime-conventions). `ReceiptProvider` follows the
payment-context conventions (multipart upload lets the browser set the
boundary); both receipt event types joined the web realtime union. i18n
`receipts.*` + `nav.receipts` in EN + HE.

Found-by-test fix: void async ops made success indistinguishable from
failure in the `.then(r => r !== undefined)` guard — intake/row ops now
resolve to counts/flags.

Tests: upload-zone spec (5) + client spec (11). **Web suite 1101 green.**

**Coordination note:** budget work (Phase 10) is in progress in the same
tree in parallel — receipt commits stage files explicitly and leave
`apps/api/src/budget/*` + its module/event wiring untouched.

**Next** — 7.8 (review page: header + items editing, merchant
autocomplete), 7.9 (confirm → payment), 7.10 (closing pass).

## 7.8 — Receipt review & edit

**API.** Three REVIEW-only editing endpoints on the receipt resource:

- `PATCH /receipts/:id` — header corrections (`extractedMerchantName`,
  `merchantId` link/unlink, `purchasedAt`, `currency`, `totalCents`,
  `discountCents`). All fields optional; an explicit `null` clears a
  nullable column while omission leaves it untouched (DTO uses
  `@IsOptional()` + `@ValidateIf((o) => o.field !== null)` so `null`
  bypasses the value validators). Editing is gated to `REVIEW`
  (`assertInReview`); merchant link is validated to exist.
- `PUT /receipts/:id/items` — full line-item replacement (max 200 rows) in
  a transaction (`deleteMany` + `createMany`, 1-based `position`). Each
  row's `categoryId` is validated against the user's visible OUT
  categories (`CategoryService.list(userId, { direction: 'OUT' })`), so
  items can't be filed under a hidden/foreign category.
- `GET /merchants?search=` — global merchant registry autocomplete;
  normalized `contains` match (`take 10`).
- `normalizeMerchantName` util (NFD → strip diacritics → lowercase →
  collapse whitespace → trim → `slice(0, 200)`) backs both merchant
  matching and dedup. `ReceiptModule` now imports `CategoryModule`;
  `MerchantController` registered.

**Web.** `/receipts/[receiptId]` review page (server shell → client under
`ProtectedRoute`):

- **Preview** — authenticated file fetch (`fetchFileBlob` → `Bearer`) piped
  through `URL.createObjectURL` (an `<img src>` can't carry the token),
  revoked on cleanup; PDFs render in `<object>`, URL-sourced receipts link
  out instead of fetching.
- **Header form** — merchant input with a 300ms-debounced autocomplete;
  picking a suggestion pins the registry `merchantId` (shows a "linked"
  hint), typing again unpins it. Date/currency/total/discount with a live
  advisory **mismatch warning** (`total − (Σ items − discount)`), which
  never blocks saving.
- **Items table** — editable rows (name, qty, total, per-item category
  select) with add/remove; client-side validation (non-empty name,
  positive qty, parseable total) before save.
- **Save** = `updateReceipt` (PATCH header) then `replaceItems` (PUT items),
  both under one `saveOp`; success rehydrates from the PUT response.
  Non-`REVIEW` statuses render read-only; `FAILED` shows a retry banner.
  Realtime `receipt.updated` rehydrates unless mid-edit at the same status;
  resync refetch is skipped while the form is dirty.
- Context gained `updateReceipt` / `replaceItems` / `searchMerchants` /
  `fetchFileBlob`; wire types `ReceiptItemInput` / `UpdateReceiptInput` /
  `MerchantSuggestion`; list rows now link to the review page.
  `receipts.review` i18n namespace added (EN/HE parity verified).

### Tests

API: 65 receipt-suite tests green (adds `update` / `replaceItems` /
`searchMerchants` / normalization coverage). Web: review-client spec (17)
covers hydrate, 404/500 load branches, save PATCH+PUT payloads, merchant
debounce/pick/unpin, mismatch, read-only, FAILED retry, add/remove rows,
blob preview vs URL link, realtime rehydrate + dirty-guarded resync; plus
the list-row Link. **Web receipt specs 31 green; typecheck + lint clean.**

**Coordination note:** budget work (Phase 10) still in the same tree —
7.8 staged its 18 files explicitly; `apps/api/src/budget/*`,
`app.module.ts`, and `realtime/events.types.ts` left untouched.

**Next** — 7.9 (confirm → Payment OUT + PaymentDocument), 7.10 (closing
pass: integration + E2E, i18n sweep).

## 7.9 — Confirm receipt → payment

**API.** `POST /receipts/:id/confirm` turns a reviewed receipt into money.
REVIEW-only; the receipt must already carry a total + currency (the review
step fills them). One transaction creates:

- a **Payment** (`OUT` / `ONE_TIME`, `POSTED`) from the receipt's total /
  currency / purchase date (falling back to upload time), the body's primary
  category, and its attribution scopes;
- a **PaymentDocument** (`kind: 'receipt'`) pointing at the receipt's stored
  `fileRef` (skipped for URL receipts with no snapshot yet);
- the receipt→payment **link** (`status: CONFIRMED`, `paymentId`), plus a
  **Merchant** in the global registry when the reviewed name isn't linked yet
  (normalized-name find-or-create). Atomic, so a CONFIRMED receipt always
  points at a real payment — no orphans, no double-confirm. Audits
  `RECEIPT_CONFIRMED` (+ `MERCHANT_CREATED` when one is registered).

The payment build reuses `PaymentService` rather than duplicating it. Three
new public methods, all sharing the existing private validators:
`validateExpenseInputs` (amount cap, supported currency, non-future date,
category visibility + OUT direction, in-scope attributions — reads only, run
before the tx), `createExpenseWithinTx` (payment + attributions + optional
document inside a caller-provided transaction), and `publishCreated` (map →
recipients → `payment.created` fan-out, now also used by `create()` so the
fan-out lives in one place). `ReceiptModule` imports `PaymentModule`; no
cycle (payment doesn't depend on receipts).

**Web.** `ReceiptConfirmDialog` (portal, ESC/backdrop close) collects the
primary OUT category (`PaymentCategoryPicker`, fed the review page's loaded
categories) and attribution scopes (`PaymentScopeSelector`, last-used seeded
from `remember.ts`) plus an optional note, POSTs confirm, and on success
navigates to `/payments/:paymentId`. The review page gains a **Confirm**
action beside Save — disabled while there are unsaved edits (confirm uses the
server's stored values), with the primary category pre-selected from the most
common line-item category. `confirmReceipt` context method + `ConfirmReceiptInput`
wire type; `receipts.confirm` i18n namespace (EN/HE parity verified).

### Tests

API: +5 `PaymentService` (validate / create-within-tx / publishCreated), +5
receipt-service confirm (payment+document+merchant+link+audits, merchant
reuse, URL-no-document, REVIEW/total/currency guards, validation short-circuit),
and a new **6-case confirm integration suite** (real app + Redis: full
payment/document/merchant/link/audit/list assertions, existing-merchant reuse,
double-confirm 400, missing-total 400, IN-category 400 with no write, non-uploader
404). Web: +7 `ReceiptConfirmDialog` (seed, submit payload, note trim, scope
change, missing-category guard, failure toast, cancel), +4 review-page confirm
wiring (opens with receipt + default category, disabled-while-dirty, navigate,
hidden for non-REVIEW). **api receipt+payment 446 green; web receipt specs 42
green; typecheck + lint clean.**

**Coordination note:** 7.9 staged its 16 files explicitly; the budget track's
`apps/api/src/budget/*`, `app.module.ts`, and `realtime/events.types.ts`
stayed untouched.

**Next** — 7.10 (URL ingestion polish, audit-log matrix, Playwright E2E for
upload → extract → review → confirm, i18n sweep).

## 7.10 — Closing pass: SSRF guard, E2E, audit matrix (2026-07-09)

**URL-ingestion SSRF guard.** A receipt URL is user-supplied and fetched
server-side, so `assertPublicReceiptUrl` now gates it: reject non-http(s)
schemes, embedded credentials, loopback / `.localhost` / `.internal` /
`.local` hostnames, and IP literals inside loopback / private (10/8,
172.16/12, 192.168/16) / link-local (169.254/16, incl. the cloud metadata
address) / CGNAT (100.64/10) / multicast+reserved ranges — IPv4 and IPv6
(loopback, ULA `fc/fd`, link-local `fe80`, and v4-mapped `::ffff:` in both
dotted and hex-canonicalized forms). Applied at ingestion (`POST
/receipts/url` → 400 `RECEIPT_INVALID_URL`) and again on **every redirect
hop** — the extraction fetcher switched from `redirect: 'follow'` to manual
following (max 5 hops) so a public URL can't bounce to an internal address
unchecked. Known limitation (documented): DNS-rebinding to a private IP needs
connection-time pinning and is out of scope.

**Audit matrix.** The design doc's audit section is now an explicit
action/trigger/entity/details table covering the full lifecycle
(`RECEIPT_UPLOADED`, `RECEIPT_EXTRACTED`, `RECEIPT_EXTRACTION_FAILED`,
`RECEIPT_RETRIED`, `RECEIPT_UPDATED`, `RECEIPT_ITEMS_REPLACED`,
`RECEIPT_CONFIRMED`, `MERCHANT_CREATED`, `RECEIPT_DELETED`) — and corrects
the earlier claim that confirm writes `PAYMENT_CREATED`: it records the new
`paymentId` on `RECEIPT_CONFIRMED`, and the payment is announced live via the
Phase 6 `payment.created` event.

**i18n sweep.** Full EN/HE parity re-verified across the whole catalog — 778
keys each, zero diffs, no untranslated receipt strings.

**E2E.** `e2e/receipts.spec.ts` (Playwright, live stack + mock provider):
register → upload a 1×1 PNG → wait for the row to reach REVIEW → open the
review page (asserts the mock "Mock Grocery" / $16.60) → Confirm with a
primary category → lands on `/payments/:id` showing $16.60. Runs against
staging like the Phase 6 payments E2E.

### Tests

+19 URL-guard unit cases (accepts public v4/v6; rejects every private /
loopback / metadata / scheme / credential vector) + 1 `createFromUrl` SSRF
rejection. **api receipt suite 92 green; typecheck + lint clean.** The new
E2E runs in the live-stack/staging pipeline.

**Phase 7 complete** — receipts upload → pluggable LLM extraction → review &
edit → confirm → payment, with private-by-uploader receipts, a global
merchant registry, per-item categories, realtime lifecycle, and an
SSRF-guarded URL path. **Next: Phase 8** (product catalog & staged matching
over the `receipt_items` this phase persists).

## 7.11–7.13 — recognition fixes + payment-first intake

Follow-ups from staging verification (documented as a re-plan block in
IMPLEMENTATION-PLAN.md before implementation):

- **7.11 HEIC → JPEG at storage.** `image/heic` (the iPhone camera default)
  passed the upload whitelist but failed everywhere downstream — vision LLM
  APIs reject HEIC and browsers can't preview it. `ReceiptStorageService`
  now decodes HEIC via `heic-convert` (WASM, no native image libs in the
  container) and stores a JPEG (quality 0.9), fixing extraction, the review
  preview, and the confirm-time `PaymentDocument` in one place. Undecodable
  HEIC → structured `RECEIPT_INVALID_FILE_TYPE` 400.
- **7.12 Readable URL snapshots.** The fetcher handed raw HTML to the
  extraction model. New dependency-free `htmlToReceiptText()` drops
  invisible subtrees, turns block boundaries into newlines and table cells
  into tabs, decodes entities (incl. numeric Hebrew + ₪), collapses
  whitespace, caps at 100k chars; applied when the response is HTML by
  header or body sniff. Plain text passes through.
- **7.13 Payment-first intake.** A receipt is an **attribute of a payment**
  (the document that proves it), not a parallel object. The Add-payment
  dialog now offers **From receipt** (create mode): picking a file uploads
  it and hands off to extract → review → confirm, which ends in the payment.
  The payment detail endpoint exposes the `receiptId` back-link (detail
  include only) and the detail page renders a Receipt section linking to the
  source receipt — the connection is visible in both directions. `/receipts`
  remains the pipeline view. i18n EN+HE, parity clean.

Tests: storage spec 15 (HEIC convert + reject), html-to-text 7, processor
reduction assertion, payment-service back-link, dialog from-receipt ×3,
detail receipt-link ×2. **api 1031 green; web 1131 green; lint 0 errors.**

Runbook troubleshooting updated (HEIC + URL rows now describe the fixed
behaviour).
