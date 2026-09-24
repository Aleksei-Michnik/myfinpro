# Product catalog, matching & barcode (checked 2026-09-24)

Read when: touching the product registry, the staged matcher, the item walkthrough, barcode scanning, Open Food Facts import/enrichment, or product images.

## Where it lives

| Area                  | Path                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API module (24 files) | `apps/api/src/product/` — `product.service.ts`, `product-matching.service.ts`, `open-food-facts.service.ts`, `product-enrichment.{service,processor}.ts`, `product-image.{service,processor}.ts` |
| Shared contract       | `packages/shared/src/types/product.types.ts`                                                                                                                                                     |
| Web                   | `apps/web/src/lib/product/`, `components/product/`, `app/[locale]/products/`                                                                                                                     |
| Prisma models         | `Product`, `ProductAlias`, `ProductImage` (+ `ReceiptItem.productId/matchStatus/matchCandidates`)                                                                                                |

`ProductModule` is imported by `ReceiptModule` — the extraction worker calls the matcher directly.

## Two layers, and why

- **Global registry** (`products`, `product_aliases`, `product_images`): shared by all users, keyed
  by GTIN when known, plus canonical name, brand, up to 5 pictures, a default OUT category and
  multi-language aliases. Any authenticated user can search and contribute; it grows as receipts are
  confirmed. Same model as the Phase 7 `merchants` registry.
- **Private purchase data** stays on `receipt_items` (`productId`, denormalized `purchasedAt`).
  The registry **never records who bought what** — catalog stats, purchase history and price
  aggregates are always scoped to the caller's own receipts.
- Consequence: a global product may only default to a **SYSTEM** OUT category; private user/group
  categories would be meaningless or leaky for other users (`assertSystemOutCategory`).
- Price history is derived, not stored — the `(product_id, purchased_at)` index is what Phase 9
  queries hit without joining `receipts`.

## Aliases — what "teaches the system"

One `ProductAlias` row per distinct normalized spelling, unique on `(productId, normalizedName)`,
carrying `locale` and `source` (`confirmation | manual | extraction | off`) plus
`confirmationCount`. `ProductService.recordAlias` is **the** registry auto-update primitive: a new
spelling creates a row at count 1, a known one bumps the counter, which raises future alias-stage
confidence. Every walkthrough confirmation upserts the item's `rawName` with the confirmer's locale.
A `null` acting user marks a system action (the nightly OFF sweep). This is what makes the second
receipt from the same store auto-match items confirmed on the first.

## Staged matcher

`ProductMatchingService.matchItems` — batch-first: one alias query, one product query, one
prefiltered fuzzy-pool query **per receipt**, scored in-process. Constants in
`product-matching.service.ts`.

| #   | Stage     | Rule                                                       | Confidence                 |
| --- | --------- | ---------------------------------------------------------- | -------------------------- |
| 1   | `barcode` | exact GTIN hit (printed code or scan), GS1 checksum gated  | 1.0                        |
| 2   | `alias`   | `normalizeLookupName(rawName)` == a confirmed alias        | 0.95 + 0.005·count, ≤0.99  |
| 3   | `exact`   | same key == a product's `normalizedName`                   | 0.9                        |
| 4   | `fuzzy`   | Dice trigram similarity over a token-prefiltered LIKE pool | ≥0.35, capped 0.85         |
| 5   | `llm`     | `suggestedProductId` from the extraction call              | high .8 / med .65 / low .5 |

Caps: `FUZZY_POOL_LIMIT` 300, `CANDIDATES_PER_ITEM` 5, `LLM_CANDIDATE_LIMIT` 150 products injected
into the prompt (the uploader's most recently purchased). Ids outside that injected list are dropped
by the worker, same rule as category suggestions.

**Auto-link rule**: top candidate from a _deterministic_ stage (`barcode`/`alias`/`exact`) with
confidence ≥ `PRODUCT_AUTO_MATCH_THRESHOLD` (0.9) → `productId` set, `matchStatus = 'AUTO'`.
Fuzzy and llm proposals **never** auto-link — they wait for the walkthrough.

Code-first matching (8.21/8.23): `ExtractedItem.barcode` carries the product code printed on the
line; it is normalized and persisted to `receipt_items.barcode` only when it passes `isValidGtin`
(the checksum also discards most OCR misreads). A confirmed manual link **backfills
`Product.barcode`** when the product has none and the code is unowned — the registry learns and the
next receipt auto-matches. Trigram similarity is hand-rolled (`utils/trigram.util.ts`) because MySQL
has no `pg_trgm`; strings are padded pg_trgm-style so word starts weigh more.

## Walkthrough

`matchStatus` lifecycle (`PRODUCT_MATCH_STATUSES`): `PENDING | AUTO | CONFIRMED | SKIPPED`.
`SKIPPED` stays resumable and `AUTO` links may be re-pointed. Allowed in `REVIEW` **and**
`CONFIRMED` receipts — matching after the transaction exists is still valuable, since price history
counts only confirmed receipts.

`ItemWalkthroughDialog.tsx` steps through the receipt's items. Per item: ranked candidates with a
confidence meter and stage, registry search (300 ms debounce), scan-to-find, create-new, skip.
Every action is a **per-item POST** (`…/items/:itemId/match` · `/skip-match`) so closing mid-way is
always safe; saving splits into stay / close / next, so the dialog doubles as a per-row match editor
(`initialItemId`). Printed-code-first (8.23): an item carrying an extracted barcode is looked up
automatically (registry → OFF); a registry owner becomes the leading 100% candidate, a named OFF hit
is auto-imported and leads the same way with a banner. Keyboard-first: `↑/↓` or `1–9` choose,
`Enter` save+advance, `S` skip, `N` create, `←/→` navigate, `Esc` close; focus trapped, steps
announced via `aria-live`.

## Barcode scanning

`BarcodeScannerDialog.tsx`: native `BarcodeDetector` where available (polled every 180 ms), else
`@zxing/browser` **dynamic-imported** so the ~100 KB decoder never rides the main bundle. Formats:
`ean_13 ean_8 upc_a upc_e itf`. Only checksum-valid GTINs fire `onDetected`. Camera denial or
absence is not an error state — the manual-entry input is always present (also the AT path).

## Open Food Facts

`OpenFoodFactsService` — env `OFF_ENABLED` (default true), `OFF_BASE_URL` (default the public API).
Breaker opens after 3 consecutive failures for 60 s; `OFF_MIN_CALL_INTERVAL_MS` = 1000 between
calls; 8 s request timeout. A 404 is a clean `miss`, not a failure. Outcomes:
`hit | miss | unavailable | disabled` — an outage degrades to manual entry, never an error.

- **On scan** (`GET /products/barcode/:code`): registry first. With `?import=true` (all scan-driven
  flows) a _named_ OFF hit is published to the registry on the spot — alias source `off`, image
  fetched in the background — and returned as a product (`offStatus: imported`). Without the flag
  (typing in a create/edit form) the hit stays a prefill, so no duplicate row is minted under the
  user's hands. `offStatus` ∈ `registry | imported | off | miss | unavailable | disabled`.
- **Nightly sweep** (`ProductEnrichmentService`, 2026-07-25): BullMQ job scheduler id
  `product-enrichment-nightly` on the `product-enrichments` queue, cron `10 3 * * *`, upserted
  idempotently on boot and **skipped entirely when `OFF_ENABLED=false`**. Sweeps up to 200
  never-checked products per run, paced to the same 1 s etiquette interval. Fills only gaps —
  missing brand, OFF name as an `off` alias (the user-facing name is never overwritten), a primary
  image when there is none — then stamps `offCheckedAt`. A clean miss is stamped too, so it is not
  re-asked nightly. An OFF outage halts the run (`halted: true`) and leaves the rest for the next
  night, so backlogs drain across nights.
- `offCheckedAt` semantics: set at import/enrichment, **reset to NULL when the barcode changes**,
  NULL = never checked. Indexed (`products_off_checked_at_idx`, migration
  `20260725090000_product_off_checked_at`).

## Product images

`ProductImageService` + `product-images` queue. Rows first, files async: upload validates
(`PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES` 10 MB, magic-byte sniff JPEG/PNG/WebP/HEIC, never PDF), stages
the original, creates the row with a server-minted immutable `baseRef` (`yyyy/mm/uuid`) and returns
**202**. The worker re-encodes into four renditions at that stem: `<base>.webp`/`.avif` (≤512 px,
q82/q50) and `<base>.thumb.webp`/`.thumb.avif` (≤96 px, q75/q45). sharp `.rotate()` applies EXIF
orientation and re-encoding strips EXIF/GPS. AVIF is best-effort — the detail WebP is the rendition
guaranteed to exist. Job kinds: `staged` (upload), `url` (OFF prefill download, ≤5 MB, 15 s), `regen`
(backfill). `PRODUCT_IMAGE_MAX_COUNT` = 5, `position` 1-based contiguous, position 1 = primary.

Storage root: `PRODUCT_IMAGE_STORAGE_DIR` (default `<cwd>/storage/products`) — **must** be a
persistent volume in deployments; a blue/green swap deletes a container-filesystem default.
Serving (`GET /products/:id/image`, `…/images/:imageId`) uses `CookieOrBearerAuthGuard` because
plain `<img>` tags cannot send `Authorization`; `?size=thumb|full`, `?v=<token>` cache-buster
(ignored by the server but **must** be whitelisted in the DTO), AVIF-vs-WebP by `Accept`,
ETag/304, `Vary: Accept`, `Cache-Control: private, max-age=86400`. Mutations stay Bearer-only.
A boot sweep re-enqueues `regen` for rows missing renditions, skipping rows younger than 1 h
(their encode may still be in flight during a deploy overlap). Provenance is not stored — an OFF
prefill image becomes an ordinary row. Details: [`docs/image-handling.md`](../docs/image-handling.md) §1–§2.

## API surface

| Method & path                                  | Throttle /min | Notes                                                                        |
| ---------------------------------------------- | ------------- | ---------------------------------------------------------------------------- |
| `GET /products?search,limit,cursor`            | 60            | with `search`: ranked registry matches; without: caller's purchased products |
| `GET /products/barcode/:code?import`           | 60            | registry → OFF; `import=true` auto-publishes a named hit                     |
| `GET /products/:id`                            | 60            | registry row + aliases + caller-scoped stats + images                        |
| `GET /products/:id/purchases`                  | —             | caller's confirmed purchases + per-merchant price aggregates (≤100)          |
| `POST /products` · `PATCH /:id`                | —             | create seeds a `manual` alias; `barcode: null` detaches                      |
| `POST /products/:id/aliases`                   | —             | upsert on `(productId, normalizedName)`                                      |
| `POST /products/:id/images`                    | —             | multipart → **202**, background encode                                       |
| `PATCH`/`DELETE /:id/images/:imageId`          | —             | reorder (renumbers in one tx) / remove                                       |
| `GET /products/:id/image` · `/images/:imageId` | —             | rendition stream, cookie-or-bearer                                           |

Errors are `PRODUCT_*` codes from `constants/product-errors.ts`. Registry writes are audited with
the acting user (`null` = system).

## Tests

7 `*.spec.ts` under `apps/api/src/product/`; component specs for scanner, walkthrough, form,
gallery, thumb, quick-view in `apps/web/src/components/product/`. Integration:
`products.integration.spec.ts`, `off-import.integration.spec.ts` in `apps/api/test/integration/`.

## Invariants & gotchas

- **Fuzzy and LLM never auto-link.** Only `barcode`/`alias`/`exact` at ≥0.9 set `matchStatus='AUTO'`.
- **`Product.barcode` is unique but nullable** — loose goods have none; checksum-validated at the
  API boundary, so only valid GTINs ever reach the column.
- **`ReceiptItem.productId` is `onDelete: SetNull`** so registry maintenance never breaks a receipt.
- **Never overwrite a user-facing product name** from OFF; enrichment only fills gaps and adds an
  `off` alias.
- **Never put `:` in a BullMQ jobId** (BullMQ ≥5 rejects it, partially and silently —
  `docs/phase-8-progress.md` 8.25-hotfix-2).
- Guards run before pipes, so an auth failure can mask a validation 400 — test the full real-world
  image URL shape, query string included.
- Design drift (checked 2026-09-24): `phase-8-products-design.md` §1.5/§3 still describes **one**
  image per product, `POST /products/:id/image` and a WebP-only rendition; 8.25 superseded all three
  (5 images, `POST /products/:id/images`, four renditions, `products.image_ref` dropped by
  migration `20260717121000`). §4 lists `utils/gtin.util.ts`; GTIN validation actually lives in
  `packages/shared/src/types/product.types.ts`.

Deep dives: [phase-8-products-design.md](../docs/phase-8-products-design.md) §1.2–§1.4, §6 ·
[phase-8-ux-followups-design.md](../docs/phase-8-ux-followups-design.md) §3 ·
[phase-8-progress.md](../docs/phase-8-progress.md) 8.21–8.28 ·
[receipts-and-llm.md](receipts-and-llm.md) · [data-model.md](data-model.md)
