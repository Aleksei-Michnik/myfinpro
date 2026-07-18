# Phase 8 — Product Catalog, Matching & Barcode

_Kickoff: 2026-07-11; iterations 8.1–8.10 landed in one pass on 2026-07-12._

Full phase in one pass (design doc at `docs/phase-8-products-design.md`,
written at kickoff per the plan). Implements the **two-layer product DB**:
a global registry (barcode-keyed `products` + multi-language
`product_aliases`) shared by all users, and private purchase data derived
from each user's confirmed `receipt_items` — the registry never records who
bought what.

## 8.1 - Schema

**(`20260711100000_phase8_81_products`, expand-only)**:
`products` (unique nullable GTIN barcode, canonical + normalized name,
brand, image ref, system-only default category), `product_aliases`
(normalized spelling unique per product, locale, source, confirmation
count), `receipt_items` gains `product_id` (SetNull), `match_status`
(`PENDING|AUTO|CONFIRMED|SKIPPED`), `match_candidates` JSON, and a
**denormalized `purchased_at`** (backfilled in the migration; kept in sync
by extraction/PATCH/PUT and frozen to the payment date on confirm) so the
Phase 9 price queries hit `(product_id, purchased_at)` without joining
receipts. Shared package: `product.types.ts` (match enums/candidate shape,
`PRODUCT_AUTO_MATCH_THRESHOLD`, GTIN mod-10 validation) and
`normalizeLookupName` — the one normalization rule for both registries;
`merchant-name.util` deleted, receipt service now uses the shared fn.

## 8.2 - Product API `ProductModule` (imported by `ReceiptModule` — the

worker and walkthrough are its consumers): list = ranked global search
(`?search`, any recorded language or barcode) / caller's purchased products
(groupBy on the new index, keyset-paginated, per-product stats via two
batched queries — no N+1); get w/ aliases + caller stats; create/update
(GTIN checksum + uniqueness, **system-OUT-only default category** — a
global row must never reference a private category); alias add (upsert →
count bump); `GET /products/barcode/:code`; purchases endpoint with
per-merchant price aggregates, always scoped `uploadedById` + CONFIRMED.
Registry writes audited (`PRODUCT_CREATED/UPDATED`,
`PRODUCT_ALIAS_RECORDED`, `RECEIPT_ITEM_MATCHED`).

## 8.3 - Staged matcher

`ProductMatchingService`: barcode(1.0) →
confirmed-alias (0.95 + per-confirmation bonus) → normalized-exact (0.9) →
trigram fuzzy (dependency-free Dice over token-prefiltered pools,
0.35–0.85). Batch-first: one alias + one product + one capped LIKE pool
query per receipt, scoring in-process. The extraction call now carries the
uploader's ~150 most recent products and the schema gains
`suggestedProductId` (validated against the injected list — the
**cross-language stage**: `חלב 3%` ↔ "Milk 3%"). Worker merges all stages
into per-item candidates; deterministic top ≥ 0.9 **auto-links**
(`AUTO`) and backfills the product's default category when the item came
back uncategorized.

## 8.4 - Walkthrough UI

`ItemWalkthroughDialog` on the review page (REVIEW CONFIRMED):
steps through items with ranked candidates + confidence
meters, registry search, scan-to-find, create-new, skip. Keyboard-first
(↑↓/1-9 choose, Enter confirm, S skip, N new, ←→ navigate, Esc close);
every action is one per-item POST so progress is server-persisted and
SKIPPED stays resumable. Focus-trapped dialog, `aria-live` progress,
reduced-motion-safe. Item rows show match-state dots; PUT /items carries
match state over for unchanged names (an edited name invalidates its
match).

## 8.5 - Registry auto-update

Confirm records the raw spelling as an alias
(uploader's locale, `confirmation` source) via upsert-increment inside the
link transaction; creating publishes globally + seeds the canonical alias.
Verified live: second upload of the same receipt **auto-matched** the item
confirmed the first time (alias stage, 0.955).

## 8.6 - Barcode scanning

`BarcodeScannerDialog`: `getUserMedia` +
native `BarcodeDetector` where present, `@zxing/browser` dynamic-imported
fallback (never in the main bundle), GTIN-validated accepts only. Camera
denial degrades to an always-present manual-entry input (also the AT/
keyboard path). Scan-to-find in walkthrough + catalog; scan-to-attach in
the product form.

## 8.7 - Open Food Facts

`OpenFoodFactsService` behind a circuit breaker
(3 failures → 60s open) + min-interval rate limit; unknown barcodes
prefill name/brand/image in the create form; outage/disabled degrade to
`unavailable`/`disabled` — manual entry, never an error. Live-verified
(Nutella barcode → prefill).

## 8.8 - Product images

One image per product. Uploads magic-byte-checked
and staged, then a `product-images` BullMQ worker re-encodes via sharp
(auto-rotate, ≤512px, WebP — EXIF/GPS stripped by construction); OFF
prefill images ride the same queue as https fetch jobs. Served with strong
ETag → verified 304 revalidation; `?v=` cache-busting on re-upload.

## 8.9 - Catalog UI\*\* `/products` (sidebar entry)

Debounced registry search vs. "my products" grid (lazy images, purchase stats,
skeletons with the
same cell geometry — no CLS), barcode scan-to-find, create dialog.
`/products/:id`: image upload, aliases with locale tags, barcode, default
category, per-merchant price table + purchase history linking back to
receipts.

## 8.10 - Tests + polish

Shared 151 (GTIN/normalize/validator), api **1057** unit green
(matcher stages, trigram, OFF breaker, service rules,
worker auto-link) + new `products.integration.spec.ts` (6 green:
registry CRUD/search/cross-language alias/barcode, walkthrough
confirm/skip/guards, privacy boundary) + receipts-confirm integration
re-green; web **1143** green incl. walkthrough + scanner specs; EN/HE
parity for the full `products` namespace; typecheck/lint/Next build clean.
Live E2E against the dev stack: upload → extract → walkthrough
create-and-link → second-upload auto-match → confirm → catalog/purchases →
image pipeline → OFF prefill.

**Also:** `docs/runbook-llm-extraction.md` gains §9 — accepted direction
(2026-07-12) to move LLM access to a **per-user setting**: curated
Anthropic/OpenAI model catalog (Gemini and others later), per-provider
connection methods with **OAuth (PKCE) preferred** over pasted API keys,
optional BYOK, deployment env demoted to default/fallback. §9.4 fixes the
**mandatory security model for user-held LLM secrets** (dedicated
encrypted table — AES-256-GCM under a versioned master key, write-only API
with hint-only reads, single decrypt boundary, log/audit redaction,
save-time validation, re-auth + throttling, deletion-request wipe,
master-key + OAuth-token rotation/revocation). Implementation is the next
LLM-track iteration.

**Phase 8 complete** — receipt items now resolve into a shared product
registry with staged + LLM matching, barcode/OFF enrichment, images, and a
private purchase catalog. **Next: Phase 9** (purchase analytics over
`(product_id, purchased_at)`).

## 8.11 - Follow-up: LLM selection + BYOK (runbook §9 implemented)

**Shipped the §9 design end-to-end.** Every LLM call now resolves the
model per uploader at call time: `user selection (own key → shared env
key)` → `deployment default (RECEIPT_EXTRACTION_PROVIDER)` → mock.

**8.11 Schema.** Expand-only migration
`20260712100000_phase8_11_user_llm_settings`: nullable
`users.llm_provider/llm_model` + new `user_llm_credentials` (one row per
user × provider, `credential_kind` ready for OAuth later, unique
`(user_id, provider)`, `onDelete: Cascade`).

**8.11 Shared.** `llm.types.ts` — the one catalog constant
(`LLM_MODEL_CATALOG`, verified against provider lineups 2026-07-12:
claude-fable-5 / claude-sonnet-5 / claude-opus-4-8 / claude-haiku-4-5 +
the OpenAI GPT-5.6 family gpt-5.6 (=sol) / gpt-5.6-terra / gpt-5.6-luna /
gpt-5.2), `findLlmModel`, `isLlmProvider`, and per-provider key shape
gates (`LLM_API_KEY_PATTERNS`, OpenAI pattern excludes `sk-ant-` so
cross-provider pastes fail fast).

**8.11 API (`src/llm/`).** `llm-crypto.util` (AES-256-GCM,
`v1:<iv>:<tag>:<cipher>` envelope, 32-byte base64 master key from
`LLM_SECRETS_ENCRYPTION_KEY` — production boot fails without it);
`LlmCredentialsService` as the **single decrypt boundary** (shape gate +
save-time live probe where only a definite 401/403 rejects, hint-only
reads/audit, `resolveApiKey` internal-only, decrypt failures degrade to
the shared key); `LlmSettingsService` (catalog availability = shared env
key ∪ user key; selection validated against catalog **and** availability);
`LlmController` — `GET /llm/catalog`, `PUT /llm/selection`,
`GET /llm/credentials`, `PUT|DELETE /llm/credentials/:provider` with
`FreshAuthGuard` (token ≤10 min old) + 5/10 min throttle on writes; pino
`redact` gains `req.body.apiKey`; account-deletion request wipes
credentials immediately (not after the grace period).

**8.11 Extraction.** Anthropic/OpenAI providers now take explicit
`{apiKey, model}` (built by the factory for the deployment default or by
the new `ExtractionResolverService` per user); resolver caches resilient
instances per `(provider, model, key-digest)` so breaker state stays
coherent, and fails **permanently** with settings-facing messages when the
selected model left the catalog or no key exists. Worker logs/audits
`provider/model/keySource` — never key material.

**8.11 Web.** Settings → Account gains the **AI model** card
(`LlmSettingsSection`): catalog picker with unavailable models disabled
until a key unlocks them, per-provider key rows (masked input, last-4
hint, replace/remove, shared-key notice), 401 on credential writes mapped
to a "sign in again" message; EN/HE parity (`settings.account.llm.*`).

**8.11 Tests.** Shared 157 green (catalog + patterns); api **1089** unit
green (crypto roundtrip/tamper/rotation-version, credentials service
incl. probe verdicts + unconfigured/production boot, settings
availability/selection, resolver precedence/cache/permanent failures,
fresh-auth guard, deletion wipe) + new `llm-settings.integration.spec.ts`
(6 green: encrypted-at-rest row assertions, hint-only reads, availability
gating, isolation, clear/delete); web **1150** green incl.
`LlmSettingsSection` spec; typecheck clean everywhere.

**Runbook** §9 updated to shipped status with the real endpoints; §9.2b
OAuth connectors remain the next LLM-track step. Ops: set
`LLM_SECRETS_ENCRYPTION_KEY` on staging/production **before** deploying.

## 8.12 - URL receipts routed by actual content

URL intake (Phase 7: paste an e-receipt link on the Receipts page →
`POST /receipts/url` → SSRF-guarded server fetch → LLM) previously treated
every response as text. Real e-receipt links from text messages often
serve a **PDF or an image directly** — those bytes were mangled through
`res.text()` into mojibake before reaching the model.

**Fix.** The worker now fetches bytes and routes by ACTUAL content
(`receipt-content-sniff.util`: magic bytes first, Content-Type header only
as a fallback — receipt hosts frequently mislabel): PDF → native document
input, JPEG/PNG/GIF/WebP → native vision input (same path as direct
uploads), HTML/text → the Phase 7.12 readable-text snapshot. Unknown
binary fails permanently with a clear reason instead of feeding garbage to
the model; downloads are capped at the same 10 MB as direct uploads.

**HTML (the dominant online-receipt shape) also got more robust**: the
full page is reduced to readable text FIRST and only the text is capped —
previously the raw HTML was sliced at 500 K chars before reduction, so
receipt lines sitting after large inline script/CSS blobs were silently
cut off.

**Tests.** New sniffer spec + 4 processor cases (PDF URL via magic bytes,
image URL mislabelled as HTML, oversized/unsupported binary → permanent
failure with reason, receipt lines after a 600 KB script blob survive);
api suite **1097** green. Live E2E on the dev stack: real HTML page, PDF
and PNG URLs all fetched, extracted and reached REVIEW.

## 8.13 - Add Payment: receipt intake chooser (device upload + URL)

The "From receipt" strip in the Add Payment dialog used to jump straight
into the file picker — e-receipt links from text messages had no path from
here (design: `docs/phase-8-receipt-intake-design.md` §1; 8.14 adds the
barcode option next).

**Web.** The strip is now a chooser: **Upload from this device** (the
existing file input) and **Add from URL** — a toggle
(`aria-expanded`/`aria-controls`) that reveals a labelled URL field;
Enter adds the receipt and never submits the payment form. Both paths
share one `useAsyncOperation` handoff: create the receipt
(`uploadReceipt` / `createFromUrl`), route to `/receipts/<id>` review,
close the dialog; failures toast and keep the dialog open. Dark-mode
variants on every new element; EN+HE strings added (unused legacy
`fromReceipt` key removed).

**Tests.** 4 new dialog cases (toggle reveals the row, URL submit routes
to review and closes, Enter is contained to the intake, failure toasts and
keeps the dialog); web suite **1154** green.

## 8.14 - Manual receipt via barcode scanning

The third intake path (design §2): for purchases with no scannable or
linkable slip, compose the receipt by scanning the products themselves. No
LLM — the user is the extractor, so the receipt is born straight in REVIEW.

**API.** `POST /receipts/manual` `{ currency, merchantName?, purchasedAt?,
items: [{ productId, quantity, unitPriceCents }] }` (≥1 item). Resolves
every product (404 on any unknown id), then creates a `source: 'manual'`
receipt in **REVIEW** with each line pre-linked (`matchStatus` CONFIRMED,
stage `barcode`, confidence 1.0, `rawName` = product name, `categoryId`
from the product default), `totalCents` = Σ. No extraction job is
enqueued, and retry-extraction is rejected for manual receipts. Confirm
creates the payment through the unchanged path. Shared `RECEIPT_SOURCES`
gains `'manual'`; the response DTO's `source`/`status` enums now derive
from the shared arrays (DRY).

**Web.** New `ManualReceiptDialog` (opened by the "Scan product barcodes"
chooser button) reuses `BarcodeScannerDialog` (camera + manual-GTIN AT
path) and `ProductFormDialog` (unknown barcode → create). Each scan adds a
line = product × quantity × unit price; **price memory** — re-scanning a
product bumps its quantity, and a new line's price prefills from the
product's most recent purchase (`GET /products/:id/purchases`,
`merchants[].lastUnitPriceCents`). Submit posts the receipt and hands off
to review. The datetime-local helpers were extracted to `@/lib/datetime`
and shared with the payment form (DRY). Dialog semantics, focus management,
Esc/backdrop close, `aria-live` scan feedback, dark-mode variants; EN+HE
strings.

**Tests.** Service (pre-linked items + summed total, 404 on unknown
product, retry rejected), controller, and 5 integration cases (REVIEW with
CONFIRMED items + no queued job, 404, empty-list 400, retry 400, confirm →
payment). Web: 7 `ManualReceiptDialog` cases (scan adds + price prefill,
re-scan increments, unknown-barcode create, submit payload + handoff,
price-required gating, remove) + chooser-opens-dialog. api unit **1101**
(+5 manual-receipt integration) / web **1162** green.

## 8.15 - Attach receipts to existing payments + LLM reconciliation

Closes the loop the user asked for: existing payments can have a receipt
attached, it's analysed by the LLM, and if the extracted total/category
differ from the payment a confirmation dialog lets the user keep or update
each — products update regardless (design §3).

**API.** `POST /payments/:id/receipt` (file) and `/receipt-url` create the
receipt with `paymentId` set **at creation** — a `PaymentReceiptController`
in the receipt module (routed under `/payments` to dodge a circular import
into PaymentModule). Guards: expense payments the caller created only
(404-not-403), one receipt per payment (unique `payment_id`). Extraction
runs unchanged; `confirm` now rejects attached receipts (they finish via
reconcile). `POST /receipts/:id/reconcile` `{ applyTotal, applyCategory }`
flips REVIEW → CONFIRMED **without creating a payment** and, per the flags,
overwrites the payment's amount (+currency) and/or category — the payment
mutation reuses `PaymentService.update` for validation/audit/realtime.
The receipt's category is its **dominant item category by spend**, a new
shared `dominantReceiptCategoryId` used by both the endpoint and the web
dialog so they never disagree. Item `purchasedAt` is frozen to the
payment date; audit `RECEIPT_RECONCILED`.

**Web.** `AttachReceiptDialog` (device + URL — the LLM-analysed paths)
opens from a new expense-only "Attach receipt" row-menu action and hands
off to the receipt review page. `ReconcileReceiptDialog` fetches the
payment, compares total + category, and offers keep/update per differing
field (defaulting to the receipt); it auto-opens the moment an attached
receipt reaches REVIEW, and the review page swaps Confirm → Reconcile for
any receipt carrying a `paymentId`. The datetime helpers extracted in 8.14
are reused. Full a11y (dialog semantics, radio groups, focus, Esc) + dark
mode; EN+HE strings.

**Tests.** Service (attach guards: ownership 404, duplicate, non-expense;
reconcile applies total+currency+dominant category then CONFIRMS, no-op
when both false, not-attached rejected; confirm rejects attached),
`PaymentReceiptController`, and 6 integration cases (attach, foreign-404,
duplicate-400, reconcile applies, reconcile no-op, attached-can't-confirm).
Web: `AttachReceiptDialog` (3), `ReconcileReceiptDialog` (4), PaymentRow
attach-item visibility (3), review-page reconcile branch (2). api unit
**1113** (+6 integration) / web **1174** green.

## 8.17 - Online-receipt URL intake: provider adapters + empty-result guard

Bug fix (design §5). A real online receipt — a Pairzon e-receipt link —
imported **blank**: the review opened with nothing extracted. Root cause:
the page is a **client-side-rendered SPA**. The short link 302s to an HTML
shell with no receipt data; the browser then loads it over XHR from a JSON
endpoint (`/v1.0/documents/<docId>?p=<prefix>`). Our server fetch only saw
the shell (reduced to a few hundred chars of chrome ending "Loading…"), so
the model read nothing and the receipt landed in REVIEW empty. Automated
tests and a green deploy missed it — none exercised a real SPA receipt.

**API.** URL resolution moved out of the worker into a new
`ReceiptUrlIntakeService` fronted by a **provider registry**. An adapter
`matches(host)` and `resolveDataUrl(url, fetchSafe)` points the fetcher at
the real data endpoint (returns `null` to defer to the generic path). The
**Pairzon** adapter follows the short-link redirect to learn `docId` +
`prefix` then reads the JSON document — exactly what the browser does, **no
headless browser**. The generic path (PDF/image → native inputs, HTML →
readable text, all from 8.12) is unchanged but now wrapped by an
**empty-result guard**: an all-empty extraction (no merchant/total/items)
fails fast with guidance ("open the link and upload a screenshot or PDF
instead") instead of a silent empty REVIEW — the net for any un-adapted SPA
or junk link. Abuse guards: per-host egress rate-limit across ALL users
(DB-counted window → **transient** back-off, not failure, so a provider's
own defences can't get our IP blocked for everyone); SSRF guard still runs
per redirect hop; 10 MB cap unchanged. Every attempt logs one anonymized,
**user-unlinked** `receipt_url_intakes` row (host + path masked to its
shape `/:token/:token` + provider + outcome) to spot providers worth
adapting, without hoarding live bearer-links. Migration
`20260713190000_phase8_17_receipt_url_intake`.

**Deferred.** Headless-render fallback for unknown SPA hosts — the provider
interface is the seam; the anonymized log will tell us which hosts justify
it. Until then those hit the empty-result guard.

**Tests.** URL fetch/route tests moved from the processor spec into a new
`receipt-url-intake.service.spec.ts` (HTML reduce, PDF/image by magic
bytes, unsupported/oversized/4xx permanent vs 5xx transient, redirect +
per-hop SSRF, loopback reject, host-politeness back-off, path-shape
logging, Pairzon dispatch incl. the reported short-link case) +
`pairzon.provider.spec.ts` (host match, id-in-query, redirect discovery,
drift → null, JSON reduction) + `maskPath` + processor delegation/empty-guard
cases. api unit **1138** green.

**Staging verification found a second bug (fixed).** With the adapter live,
the reported URL stopped landing blank but now **failed** with "Provider
returned non-JSON output". Cause (from staging logs): the adapter handed the
model the **raw** ~30 KB Pairzon JSON (~21 K input tokens of hashes, ids,
loyalty and per-item category trees); the model thought over the noise and
hit the output ceiling, truncating the structured JSON mid-array
(`stop=max_tokens`). Fix: the adapter now **reduces** the document to a
compact receipt text (merchant/date/currency/total + one line per item with
barcode/qty/price/discount, ~1.4 K tokens for a 39-line receipt), dropping
the shopper's loyalty name and masked card/voucher `notes` so that PII never
reaches the model; and the shared extraction output cap was raised
(8192 → 16384, `EXTRACTION_MAX_OUTPUT_TOKENS`, DRY across both providers) for
large grocery receipts. The provider interface became `resolveContent` (the
adapter owns both the endpoint and the reduction). Verified the reducer
against the real captured document (30495 → 4101 chars, no PII leak).
Staging verification **passed** — the reported receipt now extracts merchant,
total and all 39 line items into REVIEW.

## 8.18 - Accessible receipt document viewer + payment-view purchase details

Follow-up UX from the same review (the receipt page's inline preview was hard
to read, and a payment gave no at-a-glance list of what was bought).

**Receipt page — popup document viewer.** New `ReceiptDocumentViewer`: a
portal-mounted, focus-trapped dialog (the app's standard modal pattern —
ESC/backdrop close, focus snapshot+restore, Tab trap). Images support zoom
(buttons, wheel, `+`/`-`/`0` keys) and drag-to-pan; PDFs render in the
browser's native viewer with a download fallback. The review page's inline
image is now a button that opens it; PDFs get a "view document" button. URL
receipts keep their external link (nothing to embed). Uploaded blob is reused
from the existing preview fetch.

**Payment view — foldable purchase details.** New `PaymentPurchaseDetails`
replaces the bare "view receipt" link with an accessible disclosure
(`aria-expanded`/`aria-controls`) that **lazy-loads** the linked receipt on
first expand and lists its products/services (name + brand, quantity × unit,
line total in the payment currency), plus the full-receipt link. A receipt is
private to its uploader, so a co-viewer of a shared payment who can't read it
gets a soft "unavailable" note (404/403) rather than an error; other failures
show the retry banner.

**Tests.** `ReceiptDocumentViewer` (image zoom controls, PDF branch, loading,
ESC/backdrop/close) + `PaymentPurchaseDetails` (collapsed-by-default, lazy
load + list + currency, fetch-once across toggles, empty, 404-unavailable) +
updated `payment-detail` spec for the fold. EN+HE strings; orphaned
`receiptTitle` removed. web **1184** green; typecheck clean.

## 8.19 - Payment Documents panel, cross-member receipt access, navigation

_Status: shipped._ Receipt↔payment cohesion fixes raised on staging
(design §7):

- **Cross-member receipt access** (API): a receipt linked to a payment should
  be viewable by anyone who can see the payment (e.g. group members), not just
  the uploader. Receipt reads (`GET /receipts/:id`, `/file`) move to a
  `loadViewableOrThrow` guard (uploader OR `PaymentService.assertVisible` on
  the linked payment); mutations stay uploader-only.
- **Documents panel** (web): replace the stale "coming in Phase 9"
  placeholder with a real `PaymentDocuments` list of the payment's receipt
  file(s), opened in the 8.18 viewer.
- **Payments nav** (web): surface the existing `/payments` list (6.16) in the
  sidebar.
- **Receipt → payment backlink** (web): link the receipt review page to its
  attributed payment when `paymentId` is set.

API: `loadViewableOrThrow` (owner OR `assertVisible` on the linked payment)
for `getOne`/`openFile`; mutations unchanged. Web: `PaymentDocuments` (file
row + shared viewer, URL link-out, unavailable/none states) replacing the
deleted placeholder; sidebar **Transactions** item (the stale unused
`nav.transactions` key repurposed — the label is "Transactions", the umbrella
term for income/expense/transfers, not "Payments"); receipt→transaction
backlink. api unit **1141** / web **1188** green; both typechecks clean.
Follow-up: a full **Payment → Transaction** rename (API routes + entity + DB
table, per user decision) lands next as its own change.

**Hotfix (staging verification):** the Documents viewer spun forever. Staging
logs showed `GET /receipts/:id/file` → 404 "Receipt file not found" — the DB
row exists but the FILE is gone. Root cause: the api service had **no volume**
for `RECEIPT_STORAGE_DIR`, so uploaded receipt files lived in the container's
writable layer and were destroyed on every blue/green swap (files uploaded
before the last deploy are unrecoverable; DB rows remain). Fix: fixed-name
`…-receipts` volume mounted at `/data/receipts` + `RECEIPT_STORAGE_DIR` env in
BOTH staging and production compose (fixed `name:` because each slot runs
under its own compose project). Web: the silent `catch` that turned that 404
into an endless spinner now surfaces a `loadFailed` error in the viewer
(`loadError` prop) and an inline error on the review-page preview; close +
reopen retries. Also: the viewer is now titled by the **file name** — leading
with the merchant name (receipt data in the receipt's own language, e.g.
"קסטרו") read as a localisation bug for an EN user.

## 8.20 - Rename Payment → Transaction end-to-end

Per user decision: "Payment" was the wrong umbrella term for an entity that
also models incomes and (future) user-to-user transfers; the product term is
**Transaction** (HE: תנועה, plural תנועות). ~6,000 occurrences across ~200
files renamed in one sweep (design §8).

**DB.** Hand-written migration `20260715120000_rename_payments_to_transactions`:
7 tables, all `payment_id`/`parent_payment_id`/`payments_count` columns, every
index and FK constraint name — FKs dropped → renamed → re-added with identical
referential actions; pure renames, zero data touched. Two uniques whose new
default names exceed MySQL's 64-char limit pinned via `map:`. Validated with
`prisma migrate diff` against the applied DB: **no drift** (the check caught
one missed column, `payments_count`, before anything shipped).

**API.** `src/payment` → `src/transaction`; routes `/api/v1/transactions`;
`TRANSACTION_*` error codes/audit actions; realtime events
`transaction.*`; queue `transaction-occurrences` + scheduler ids. BullMQ job
schedulers live only in Redis keyed by queue name, so the rename added an
`onApplicationBootstrap` **scheduler reconciliation** (re-upserts every live
schedule from the DB) — this also permanently self-heals Redis loss, which
previously would have silently killed all recurring schedules. Old
`bull:payment-occurrences:*` Redis keys are orphaned and cleaned manually on
the servers.

**Web.** Route `/payments` → `/transactions` (segment `[transactionId]`),
`lib/transaction` + `components/transaction`, testids, i18n keys and values in
BOTH locales. The Hebrew pass rewrote gender agreement (תשלום m. → תנועה f.:
נמחק→נמחקה, זה→זו, חוזר→חוזרת, …). Kept real-world payment senses:
"repayment" (loan DTOs), "payment cards" (pairzon reducer), and the DUE status
label לתשלום (the act of paying, not the entity). localStorage last-used keys
renamed (users lose remembered form defaults once).

**Docs.** Living docs renamed (`phase-6-payments-design.md` →
`phase-6-transactions-design.md`, receipt/products/budgets design docs,
UI conventions, IMPLEMENTATION-PLAN); the progress journal and RCA
post-mortems stay historical — only link paths updated.

**Tests.** api unit **1143** green; web **1190** green; both typechecks +
lints clean. Full API integration suite run: all transaction/receipt/product
suites pass; one stale expectation fixed (INSTALLMENT now correctly demands a
plan body — plans shipped in 6.20); remaining failures are pre-existing
environmental issues in legacy auth-era suites (they boot AppModule against
the shared dev DB with hard-coded emails and no cleanup — rerun-hostile) plus
testcontainer start flakes; none touch the renamed surface.

## 8.21 - Extraction hardening: curated models, chunked continuation, printed barcodes

Production incident: Claude Haiku 4.5 rejected `thinking: adaptive` with a
400 (each attempt burned three paid retries), and a ~50-line receipt on
Claude Sonnet 5 hit the 16384-token output ceiling mid-JSON — surfacing as
the misleading "Provider returned non-JSON output" (same failure mode as
8.17, one ceiling higher).

**Models.** Haiku 4.5 removed from `LLM_MODEL_CATALOG`; the catalog comment
now states the compatibility bar (adaptive thinking + structured outputs /
strict json_schema — exactly what the extraction call sends). The resolver's
existing "model no longer available — choose another in Settings" failure
covers stored selections.

**Chunked continuation (both providers).** Output ceiling → 64K (the
Anthropic call now streams per SDK guidance >16K). A pass stopping at the
ceiling salvages its complete line items from the truncated JSON
(string-aware brace scanner) and CONTINUES in a fresh call anchored on the
last captured line; header comes from the final completed pass; bounded at 4
continuations; a truncated pass that salvages nothing fails permanently with
its own message (never a parse error). 4xx rejections (except 429) are
permanent — no more resilience-layer retries on request/model
incompatibilities.

**Printed product codes.** `ExtractedItem.barcode` in the shared contract +
provider schema + prompt; matcher stage 1 = exact GTIN hit at confidence 1.0
(auto-links, same as manual scans; GS1 checksum gates OCR misreads);
`receipt_items.barcode` persists the normalized code (migration
`20260716120000`); a confirmed manual link backfills `Product.barcode` when
the product has none and the code is unowned — so the registry learns and
the NEXT receipt auto-matches.

**Tests.** api unit 1155 green (chunking, salvage edge cases, barcode stage,
4xx mapping); shared 160; `prisma migrate diff`: no drift.

## 8.22 - Multi-photo receipts: one long slip photographed in ordered pages

Per user request: very long slips don't fit one photo. `receipt_files` now
owns a receipt's ordered pages (migration `20260716130000` creates the
table, moves existing files to page 1, drops the receipts single-file
columns — no legacy readers remain).

**API.** Upload accepts 1–8 multipart `files`: all images = pages of ONE
receipt in the given order; a PDF must be alone (mixed batches 400 and the
already-stored pages of the aborted batch are deleted). Serving is
`GET /receipts/:id/files/:fileId` (8.19 co-viewer authz unchanged); delete
destroys every page; confirm writes one transaction-document row per page.
The extraction worker loads all pages in position order and each provider
sends one image block per page, with a prompt rule to treat overlapping
seams as one receipt and extract each line exactly once.

**Web.** Camera shots always stage; multi-image picks stage too; a single
picked image uploads instantly (unchanged). The staging tray shows numbered
thumbnails with per-page remove and an explicit **Upload as one receipt** /
**Upload as separate receipts** choice — batch upload of distinct receipts
stays a first-class flow. The shared document viewer gains an accessible
page navigator (Page X of Y, zoom/pan resets per page; PDFs unchanged);
attach-to-transaction accepts several photos. EN+HE strings added.

**Tests.** api unit 1155 green (upload matrix incl. PDF-mix cleanup,
multi-page extraction order, per-page serving); web 1194 green (staging
tray one-vs-separate, pager, per-page blob fetch); typecheck+lint clean;
`prisma migrate diff`: no drift.

## 8.23 — Printed-code-first matching + registry identity on review rows (2026-07-17)

User report from staging verification of 8.21: "product codes are not
extracted" — they were (23/30 items on the test receipt carried GTINs in
`receipt_items.barcode`), but the UI never surfaced them, and a code the
registry didn't own yet produced an empty "no matches proposed" dialog.
Matching a printed-code item is now a confirmation, not a search.

**API.** Receipt items expose `productHasImage` + `productImageVersion`
(RECEIPT_INCLUDE joins `imageRef`; version derivation shared with the
product DTO via `productImageVersion()`).

**Walkthrough dialog.** Shows the item's printed code and auto-looks it up
(registry → OFF, per-code cache): a registry owner leads the candidates at
100%; an OFF hit renders a one-click **Create & link** (matchItem
`createProduct` with OFF name/brand/image + the code; server backfill from
8.21 then auto-matches every later receipt) plus **Edit first…** into the
prefilled create form. The create form auto-resolves an initial barcode on
open — the scan path previously discarded the OFF prefill until a manual
blur. Confirm split into **Save & stay / Save & close / Save & next**
(Enter = save & next); `initialItemId` opens the dialog focused on one item.

**Review rows.** Each item row gets a clickable registry-identity chip:
official name + thumbnail (authenticated product image endpoint, graceful
fallback) once matched; "Match product… · code" until then. Click opens the
walkthrough on that exact item. Server-truth gated (hidden while rows have
unsaved edits), REVIEW/CONFIRMED only. EN+HE strings added.

**Tests.** api 1155 green; web 1206 green (walkthrough code-first flows,
save controls, chips, form auto-resolve — ProductFormDialog gains its first
spec); typecheck + lint clean.

## 8.24 — Receipt items as cards (2026-07-17)

User report with a phone screenshot: the review page's item grid didn't
fit a mobile viewport — fields truncated, horizontal scrolling. Design:
`docs/phase-8-ux-followups-design.md` §2.

**Web.** `ReceiptItemCard` replaces the grid rows at every width: one card
per item with labelled name / qty / unit price / discount / line total /
category fields (unit price + discount now editable), the 8.23 registry
chip, and a product thumbnail. `ProductThumb` extracted as the shared
thumbnail primitive (card, walkthrough, purchase-details fold) with a cube
placeholder fallback; shared `input-styles.ts` keeps field styling in one
place. i18n EN+HE.

**Tests.** Card spec (fields, editability gates, chip callback); purchase
details spec re-mocked the product context. api 1155 / web 1244 green.

## 8.25 — Product pictures + image optimization pipeline (2026-07-17)

Design §3. Products carry up to 5 user pictures; all product/receipt
imagery is stored as compact renditions instead of original uploads.

**Data.** `product_images` (≤5/product, `position` 1 = primary) via
expand→contract: expand migration creates the table and backfills legacy
`products.image_ref`; contract migration drops the column after cutover.
`prisma migrate diff` verified against a shadow DB (Prisma 7 dropped the
CLI flag — `shadowDatabaseUrl` now lives in `prisma.config.ts`).

**API.** `ProductImageService` renditions per image: detail ≤512px (WebP
q82 + AVIF q50) and thumb ≤96px (WebP q75 + AVIF q45), encoded async by the
existing product-image queue. Serving negotiates `Accept` (AVIF → WebP)
with `Vary: Accept`; `?size=thumb|full` picks the rendition. New
`POST/DELETE/PATCH /products/:id/images` (add from upload/URL, remove,
reorder). Post-CONFIRM receipt compaction: a worker re-encodes receipt
image pages to ≤2048px WebP q80 with a keep-original guard (skips when
re-encode isn't smaller), updating `receipt_files` +
`transaction_documents` atomically; bootstrap backfills legacy rows.

**Web.** `FileCaptureButtons` extracted as the single browse+camera
capture control (receipt intake refactored onto it); `ProductFormDialog`
gains an "Add picture" strip — staged uploads in create mode, direct
add/remove/reorder in edit mode; `imageUrl(product, size)` in the product
context; 8.24 thumbnails consume the thumb rendition. i18n EN+HE.

**Tests.** api 1189 / web 1257 green (rendition service incl. the
keep-original guard with a random-noise fixture, controller negotiation,
capture control, dialog strip); integration suite green; migrate diff: no
drift.

## 8.26 — Extraction transparency (2026-07-18)

Design §4. While a receipt extracts, the user now sees what is actually
happening — staged progress with the resolved model's name and, where the
provider yields one, a live reasoning stream. Ephemeral by construction:
events ride the in-memory SSE bus, feed no DTO/DB column/audit row, and
thought text is never logged or persisted.

**Contract.** Shared `RECEIPT_EXTRACTION_STAGES` (preparing → sending →
processing → thinking → generating → continuing) +
`ReceiptExtractionProgress`; `receipt.extraction.progress` added to both
realtime unions (uploader-only fan-out); `RealtimeFilter` gains a
`receiptId` criterion.

**API.** `ExtractionContext.onProgress` flows worker → resilient wrapper →
provider. The worker decorates updates with receiptId/userIds and the
resolved provider/model, throttles to ≤1 event/300 ms (leading +
trailing-edge coalescing, thoughts concatenated, 400-char cap) and stops
the emitter at terminal states so nothing trails REVIEW/FAILED. Anthropic:
thinking becomes `{ type: 'adaptive', display: 'summarized' }` (visibility
opt-in — catalog models default to omitted) and the existing stream now
feeds `thinking_delta`/`text_delta` into progress, with `itemsSoFar`
counted boundary-safely over the JSON output and `continuing` emitted per
8.21 chunk pass. OpenAI: the chat-completions call moves to `stream: true`
(+usage chunk) with a transport-agnostic SSE consumer — content deltas
drive `generating`; no thinking stage (not exposed on this surface). Mock
provider plays a scripted sequence when subscribed (dev/E2E), untouched
otherwise.

**Web.** `ExtractionActivity` — panel variant replaces the review page's
empty items area during UPLOADED/EXTRACTING; inline variant sits next to
the status pill on EXTRACTING list rows. Animated pulse dot, per-stage verb
rotation (~2.5 s) whenever no fresh event arrives, model label resolved via
the shared `findLlmModel` catalog, one-line thought ticker + accessible
disclosure (`aria-expanded`) over the accumulated reasoning (component
state only — reload forgets). `role="status"`/`aria-live="polite"` on the
stage line; `motion-reduce` disables ping/pulse/fade while texts keep
updating. i18n EN+HE.

**Tests.** Emitter throttle/coalesce/cap/stop, RawNameCounter boundary
cases, SSE consumer fixtures (split frames, CRLF, multi-byte UTF-8,
refusal, usage), Anthropic delta wiring + continuing pass, OpenAI streamed
end-to-end with request-shape assertions, processor emission ordering
(preparing before resolution, decorated after, nothing past terminal), web
component spec (subscription filter, catalog label fallback chain, ticker +
disclosure accumulation, inline variant, reduced-motion markup). api 1212 /
web 1265 green; typecheck + lint clean.

## 8.25-hotfix — product pictures 401 behind `<img>` tags (2026-07-18)

Production report (catalog screenshot): pictures exist for 19/22 products
— rows, files and all four renditions verified on the server — yet every
card showed the cube placeholder. The API logs told the story: every
`GET /products/:id/image` returned **401**. Plain `<img>` tags cannot send
an `Authorization` header, and the image endpoints sat behind the
Bearer-only `JwtAuthGuard`; the card's `onError` then swapped in the
placeholder. (Same-origin deploys do send the `access_token` cookie the
API has set since 6.18.1.4 — but only the SSE guard read it.)

**Fix.** The SSE `RealtimeAuthGuard` — cookie first, Bearer fallback — was
the mechanism already built for header-less endpoints; it is now the
shared `CookieOrBearerAuthGuard` (`auth/guards/`). Both picture GETs
(`:id/image`, `:id/images/:imageId`) use it; mutations stay Bearer-only.
Because `@UseGuards` instantiates the guard inside the controller's host
module, the JwtModule registration duplicated verbatim in AuthModule and
RealtimeModule became the shared `JwtConfigModule`, imported by Auth,
Realtime, and Product (one secret/TTL definition — DRY). No web changes
needed.

**Tests.** Guard spec moved with the rename; new integration case proves a
cookie-only request reaches the endpoint (404 for a product without a
picture, not 401) while a credential-less one stays 401. api 1212 green.

## 8.25-hotfix-2 — the 400 behind the 401, and dead BullMQ enqueues (2026-07-18)

Staging verification of the cookie fix still showed cube placeholders.
The logs revealed a second, stacked bug: with auth now passing, every
image GET died at validation — **400** in 2–3ms. The web client appends a
`?v=` cache-buster to every image URL (so the browser refetches when an
image changes), but `ProductImageSizeQueryDto` only declared `size`, and
the global `ValidationPipe` runs with `forbidNonWhitelisted`. Guards run
before pipes in Nest, so the 401 had masked the 400 all along — and the
hotfix's own integration test requested `/image` without the query string
a real `<img>` carries, which is why it went green.

The same staging boot log surfaced an unrelated casualty: `Rendition
backfill enqueue failed: Custom Id cannot contain :`. BullMQ ≥5 rejects
custom job ids containing `:` — unless they split into exactly three
parts, a compatibility loophole for old repeatable jobs. That lottery is
why uploads worked (`product-image:<uuid>:<ts>`, 3 parts) while the
rendition backfill (`product-image-regen:<uuid>`) and **receipt storage
compaction** (`receipt-optimize:<uuid>`) threw on every single add —
production logs show optimization failing at real confirms since 8.25
shipped (caught and logged, so confirms succeeded).

**Fix.** `v` declared on the query DTO as an optional, server-ignored
string; all four custom job ids switched to dash separators (the colon
loophole is slated for removal in BullMQ's next breaking release, so the
two "working" 3-part ids moved too).

**Tests.** The integration case now requests the full real-world URL
shape (`?size=thumb&v=…` → 404, was 400 red before the fix); unit specs
pin the dash-separated job ids for upload, regen backfill, extraction and
optimization enqueues.

**Third layer — ephemeral storage.** With auth and validation fixed,
staging still 404'd: uploads from before the deploy had no files. Receipt
storage rides a named volume (`/data/receipts`), but product images had
no `PRODUCT_IMAGE_STORAGE_DIR` and no mount — renditions were written to
the container's own filesystem, so **every blue/green swap deleted every
product picture** while the DB rows survived. This — not the 401 — is why
production showed cubes for pictures "uploaded weeks ago": the files had
been wiped by interim deploys. Fix: `myfinpro-<env>-products` volume
mounted at `/data/products` + `PRODUCT_IMAGE_STORAGE_DIR` in both compose
files, mirroring the receipts pattern. Ops: the surviving files were
copied out of the running containers into the pre-created volumes before
their next swap (staging: 4 files; production: 80 — done during the
production rollout). Rows whose files predate the running container are
unrecoverable; those pictures need re-uploading (rendered as the same
placeholder, so no UI breakage).
