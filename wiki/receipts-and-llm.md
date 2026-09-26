# Receipt intake & LLM extraction (checked 2026-09-24)

Read when: touching receipt upload/URL/manual intake, the extraction worker or provider layer, per-user LLM selection/BYOK, or the review → confirm flow.

## Where it lives

| Area                          | Path                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| API module (56 files)         | `apps/api/src/receipt/` — controllers, `receipt.service.ts` (1245 ln), processors, dto                    |
| Provider layer                | `apps/api/src/receipt/extraction/`                                                                        |
| URL intake + guards           | `apps/api/src/receipt/url-intake/`, `apps/api/src/receipt/utils/`                                         |
| Per-user LLM selection / BYOK | `apps/api/src/llm/`                                                                                       |
| Shared contract               | `packages/shared/src/types/receipt.types.ts`, `llm.types.ts`                                              |
| Web                           | `apps/web/src/lib/receipt/`, `lib/llm/`, `lib/upload.ts`, `components/receipt/`, `app/[locale]/receipts/` |
| Prisma models                 | `Receipt`, `ReceiptFile`, `ReceiptItem`, `ReceiptUrlIntake`, `Merchant`, `UserLlmCredential`              |

## Intake channels

All channels converge on the same extract → review → confirm pipeline.

| Channel                   | Entry point                             | Notes                                                                                                           |
| ------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Photo / PDF upload        | `POST /receipts` (multipart)            | 1–8 image files = ordered **pages of one receipt** (8.22); a PDF must be alone, mixed batch → 400 + cleanup     |
| Online receipt URL        | `POST /receipts/url`                    | Content-routed (8.12): magic bytes win over `Content-Type` — PDF/image → native vision input, HTML → text       |
| Manual (barcode-composed) | `POST /receipts/manual`                 | No extraction job: born in `REVIEW`, every line pre-linked (`matchStatus` CONFIRMED, stage `barcode`, conf 1.0) |
| Attach to a transaction   | `POST /transactions/:id/receipt{,-url}` | Receipt is born linked; finished by **reconcile**, not confirm (8.15)                                           |
| Link two existing objects | `POST /receipts/:id/link`               | Both already exist (8.28); only `receipts.transaction_id` is set; `DELETE …/link` detaches                      |

Intake is **transaction-first** (7.13): the primary surface is Add-transaction → "From receipt"
with a chooser (device upload / URL / scan barcodes, `docs/phase-8-receipt-intake-design.md` §1).
`/receipts` is the pipeline/history view. 8.16 ("no receipt without a transaction") is still
`planned` in `IMPLEMENTATION-PLAN.md` — orphan receipts remain a real state today.

URL adapters: `ReceiptUrlIntakeService` tries registered `ReceiptUrlProvider`s (`matches(url)` →
`resolveContent`), then a generic fetch. Only adapter today: Pairzon (Israeli retail e-receipts) —
follows the short link to learn `docId`+`prefix`, reads the JSON document and **reduces** it to
receipt essentials; the raw doc is ~30 KB of noise that truncated the model's output. Loyalty
names, masked cards and voucher numbers are dropped before the model sees anything.

## Pipeline

```
upload/url → Receipt(UPLOADED) → BullMQ 'receipt-extractions' → EXTRACTING → REVIEW → confirm → Transaction
                                                                           ↘ FAILED (retryable)
CONFIRMED → BullMQ 'receipt-optimizations' → pages re-encoded to ≤2048px WebP
```

- Statuses (`RECEIPT_STATUSES`): `UPLOADED | EXTRACTING | REVIEW | CONFIRMED | FAILED`.
  Sources (`RECEIPT_SOURCES`): `upload | url | manual`.
- Queue names live only in `apps/api/src/queue/queue.constants.ts`:
  `RECEIPT_EXTRACTIONS_QUEUE`, `RECEIPT_OPTIMIZATIONS_QUEUE`.
- Worker `receipt-extraction.processor.ts` owns everything past `UPLOADED`. Status guard: only
  `UPLOADED`/`EXTRACTING` proceed, so duplicate fires are no-ops. `ExtractionFailedError` is
  **permanent** — the receipt fails without re-throwing (BullMQ retries are not burned); transient
  errors re-throw and fail the receipt on the last attempt. Job ids carry a timestamp so a retry
  after a completed-failed job is not deduplicated away.
- **Empty-result guard**: no merchant, no positive total, no items → `FAILED` with actionable
  guidance, never a silent empty `REVIEW`. URL receipts also log outcome `empty_result`.
- Confirm creates one `Transaction` (OUT / ONE_TIME) + one `TransactionDocument` (`kind: 'receipt'`)
  **per page**, and links the receipt — all in one DB transaction.
- Reconcile (8.15) flips `REVIEW → CONFIRMED` without creating a transaction and, per flags,
  overwrites the linked transaction's amount/currency and/or category via `TransactionService.update`.
  Item/product links persist regardless — only the transaction header is negotiable.

## Storage

Files live outside the web root under `RECEIPT_STORAGE_DIR` (default `<cwd>/storage/receipts`) as
`<yyyy>/<mm>/<uuid>.<ext>`; in deployments this **must** be a persistent volume. MIME comes from
magic bytes (`RECEIPT_ALLOWED_MIME_TYPES`: jpeg/png/webp/heic/pdf), the client type and filename are
advisory — so `../` names and double extensions cannot reach disk. HEIC is converted to JPEG at
storage time (7.11) because vision APIs reject it. Cap `RECEIPT_MAX_FILE_SIZE_BYTES` = 10 MB,
`RECEIPT_MAX_FILES` = 8. Serving is Bearer-only, blob-fetched by the web — see
[`docs/image-handling.md`](../docs/image-handling.md) §3 for why this differs from product images.

## Provider layer

`ReceiptExtractionProvider { name; extract(input, ctx) }` in `extraction-provider.interface.ts`.
Input kinds: `image` (pages[]) | `pdf` | `html`. Context carries the uploader's OUT categories,
recent registry products (cross-language matching stage) and an optional `onProgress` callback.

| Implementation                                             | Role                                                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MockExtractionProvider`                                   | Default; deterministic "Mock Grocery / $16.60", no network. CI, dev, tests rely on it                                                                    |
| `AnthropicExtractionProvider` / `OpenAiExtractionProvider` | Real vision calls, structured output                                                                                                                     |
| `ResilientExtractionProvider`                              | Decorator: 3 attempts, exponential backoff from 2 s, breaker opens at 5 consecutive failures for 60 s. `ExtractionFailedError` never retries or trips it |

Two resolution paths. `extraction-provider.factory.ts` binds the **deployment default** from
`RECEIPT_EXTRACTION_PROVIDER` (unset = `mock`, or `unconfigured` under `NODE_ENV=production`; an
unknown value **fails the boot**) + `RECEIPT_EXTRACTION_MODEL`. `ExtractionResolverService` (8.11)
overrides it per uploader via `pickLlmBinding`: selection, else a stored personal key (its provider +
`LLM_DEFAULT_MODEL`), else the default; then own key → shared env key (selections only) → permanent failure.

BYOK: keys live only in `user_llm_credentials`, AES-256-GCM encrypted under
`LLM_SECRETS_ENCRYPTION_KEY` (32-byte base64), encoded `v1:<iv>:<tag>:<ciphertext>` so rotation is
incremental. `LlmCredentialsService` is the single encrypt/decrypt boundary — plaintext exists only
inside `setCredential` and `resolveApiKey`, never on job payloads (jobs carry the user id). Reads
return `{provider, keyHint(last 4), updatedAt}` only. Writes need `FreshAuthGuard` (token issued
< 600 s ago) plus a shape check and a live provider probe (`LLM_KEY_LIVE_VALIDATION`). Boot fails
without the master key when `NODE_ENV=production`; elsewhere BYOK is disabled with a warning.
Catalog = `LLM_MODEL_CATALOG` in shared; adding a model there is the only step to offer it.

## Output contract & prompt behaviour

- `ExtractionResult` + `validateExtractionResult` live in shared and run in the worker **before**
  anything touches the DB. Category/product suggestions must be ids handed to the provider.
- `EXTRACTION_MAX_OUTPUT_TOKENS = 64_000` (8192 → 16384 → 64K; the first two truncated mid-JSON and
  surfaced as a misleading "non-JSON output"). Anthropic streams above 16K per SDK guidance.
- **Chunked continuation** (8.21, `extraction-continuation.util.ts`): a pass that stops at the
  ceiling salvages its complete items with a string-aware brace scanner and continues in a fresh
  call anchored on the last captured line. `MAX_EXTRACTION_CONTINUATIONS = 4`; a truncated pass that
  salvages nothing fails permanently with its own message, never a parse error.
- **Three defences against bad output**, cheapest first (`extraction-finalize.util.ts`): prompt →
  `normalizeExtractionPayload` → one repair round-trip showing the model its own validation errors.
  Discount-line fix (2026-08-15, `7435217`): minus-signed credit lines are folded into the
  receipt-level discount and dropped as items, so `Σ items − discount == total` stays exact.
  Fractional cents are deliberately left alone (8.8 may mean 9 agorot or 8.80).
- **Reasoning**: the SSE stream is throttled/capped for transport; the worker separately accumulates
  the **full** transcript and persists it to `Receipt.extractionReasoning` (MEDIUMTEXT) at either
  terminal state (2026-07-25, `92b8c3f`). Rendered by `ReasoningDisclosure`.

## SSRF guard

`assertPublicReceiptUrl` (`utils/receipt-url-guard.util.ts`) runs at ingestion **and on every
redirect hop** (max 5): http(s) only, no embedded credentials, no loopback/`.internal`/`.local`
hosts, no IP literals in loopback/private/link-local (incl. cloud metadata)/CGNAT/multicast.
Known gap: DNS rebinding (public name resolving to a private address) is **not** caught — that needs
connection-time IP pinning. Egress politeness: ≤30 fetches per external host per 60 s across all
users, DB-counted in `receipt_url_intakes`; over the limit is a transient back-off, not a failure.
That table is deliberately user-unlinked and token-free (`pathTemplate` masks id/token segments).

## Realtime & review UI

Events (`apps/api/src/realtime/events.types.ts`), uploader only: `receipt.updated`,
`receipt.deleted`, and the **ephemeral** `receipt.extraction.progress` (no DTO, no column, no audit
row). Stages: `preparing sending processing thinking generating continuing repairing`; emission is
throttled to one event / 300 ms with `thought` capped at 400 chars (`extraction-progress.util.ts`).
`ExtractionActivity` renders it as a review-page panel or an inline list row; with no events it
rotates generic verbs until `receipt.updated` unmounts it. Never hand-roll a replacement for the
shared primitives: `ReceiptIntake` (8.29 — THE intake on every host: camera/browse/drop/URL, the
client gate, page staging, the create call), `DocumentViewer` and `FileCaptureButtons`.

## API surface

| Method & path                                   | Throttle /min | Purpose                                       |
| ----------------------------------------------- | ------------- | --------------------------------------------- |
| `POST /receipts`                                | 20            | Multipart upload, 1–8 pages                   |
| `POST /receipts/url` · `/manual`                | 20            | URL intake · barcode-composed receipt         |
| `GET /receipts` (`?status,limit,cursor`)        | 60            | Uploader's receipts, newest first             |
| `GET /receipts/:id` · `/:id/files/:fileId`      | 60            | Detail (uploader) · stream a page (co-viewer) |
| `PATCH /receipts/:id` · `PUT /:id/items`        | 30            | REVIEW-only header / full item replacement    |
| `POST /:id/confirm` · `/reconcile` · `/link`    | 20            | Terminal transitions                          |
| `DELETE /:id/link` · `POST /:id/retry`          | 20            | Detach · re-enqueue a FAILED receipt          |
| `POST /:id/items/:itemId/match` · `/skip-match` | 120           | Walkthrough per-item mutations                |
| `DELETE /receipts/:id`                          | 30            | Any non-confirmed state                       |
| `GET /merchants?search=`                        | —             | Global merchant registry lookup               |
| `GET /llm/catalog` · `PUT /llm/selection`       | —             | Model catalog + per-user selection            |
| `PUT`/`DELETE /llm/credentials/:provider`       | —             | BYOK write-only surface (`FreshAuthGuard`)    |

## Tests

21 `*.spec.ts` under `receipt/` + `llm/`; 16 web component specs under `components/receipt|product`.
Integration: `receipts-confirm`, `receipts-manual`, `receipts-attach-reconcile`,
`llm-settings` in `apps/api/test/integration/`. E2E: `apps/web/e2e/receipts.spec.ts`.
**There are no fixture receipt files** — `apps/web/e2e/fixtures/` holds only `.gitkeep`; the mock
provider is the fixture (design docs still speak of "fixture receipts (EN + HE)" — checked 2026-09-24).

## Operational essentials

- Every receipt returning "Mock Grocery / $16.60" ⇒ still on the mock provider; there is **no**
  silent runtime fallback to mock. Fix per [`runbook-llm-extraction.md`](../docs/runbook-llm-extraction.md) §2–§3 (set the var, then **redeploy**).
- Confirm what the container booted with: the log line `Receipt extraction provider: …` (§4a).
- Failed extraction: `Receipt.failureReason` + `extractionReasoning` hold the diagnosis; the review
  page renders both. Re-run with `POST /receipts/:id/retry` (FAILED → UPLOADED).
- `circuit breaker OPEN` in logs = repeated provider errors; wait the 60 s cooldown (§5).
- `stop=refusal` = the safety classifier declined the document — retry or switch model (§5).
- Cost: one vision call per receipt plus up to 4 continuations and at most one repair call; watch
  the `input=…tok output=…tok` log line (§8). Rollback to `mock` is §6.

## Invariants & gotchas

- **Validate before persisting.** Provider output always passes `validateExtractionResult`; drift
  fails the extraction, not the process.
- **`transactionId` is unique on `Receipt`**; deleting the transaction SetNulls it and the receipt
  survives as a CONFIRMED audit artifact (a re-linkable orphan).
- **Mutations are uploader-only** (`loadOwnedOrThrow`); reads use `loadViewableOrThrow`, which also
  admits members of the group the linked transaction is attributed to (8.19). Unreachable → 404.
- **Optimization only runs post-CONFIRM**, because the status machine guarantees extraction never
  re-reads the pages — the original stays model-grade for its whole extraction-relevant life.
- **Walkthrough matching is allowed in REVIEW _and_ CONFIRMED**; header edits are REVIEW-only.
- 8.11-hotfix: model fallbacks come from **`LLM_DEFAULT_MODEL`** (shared, catalog ids by
  assertion); an unset `RECEIPT_EXTRACTION_PROVIDER` is `mock` only outside production — under
  `NODE_ENV=production` it binds `UnconfiguredExtractionProvider` (permanent settings-facing
  failure, never the fixture), and a stored personal key alone binds extraction (`pickLlmBinding`).
- Never put `:` in a BullMQ jobId (BullMQ ≥5 rejects it, partially and silently —
  `docs/phase-8-progress.md` 8.25-hotfix-2).

Deep dives: [phase-7-receipts-design.md](../docs/phase-7-receipts-design.md) §2, §6 ·
[phase-8-receipt-intake-design.md](../docs/phase-8-receipt-intake-design.md) §5, §9–§12 ·
[phase-8-ux-followups-design.md](../docs/phase-8-ux-followups-design.md) §4 ·
[runbook-llm-extraction.md](../docs/runbook-llm-extraction.md) §9 · [products-catalog.md](products-catalog.md) · [data-model.md](data-model.md)
