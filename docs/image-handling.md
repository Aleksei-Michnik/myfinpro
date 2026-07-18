# Image Handling Conventions

The single reference for anything that uploads, stores, serves, or displays
images. Future image-related features MUST reuse the components and patterns
here; if a need genuinely doesn't fit, extend this document in the same
change that introduces the divergence.

Two image families exist and they deliberately differ:

| Family                | Examples                      | Nature                                | Delivery                             |
| --------------------- | ----------------------------- | ------------------------------------- | ------------------------------------ |
| **Catalog imagery**   | Product pictures              | Shared, cacheable, recognition aids   | Cookie-authed `<img src>` renditions |
| **Private documents** | Receipt pages, attached files | Sensitive, per-user proving documents | Bearer-authed blob fetch into viewer |

Pick the family first; everything else follows from it.

## 1. Server pipeline (catalog imagery — product pictures)

Implemented in `apps/api/src/product/product-image.service.ts` (design:
`docs/phase-8-ux-followups-design.md` §3).

- **Rows first, files async.** Upload validates (size cap
  `PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES`, magic-byte mime sniff — JPEG/PNG/
  WebP/HEIC, never PDFs), stages the original, creates the `product_images`
  row with a server-minted immutable `baseRef` (`yyyy/mm/uuid`), and returns
  `202`. A BullMQ worker re-encodes into four renditions at that stem:
  `<base>.webp` / `.avif` (≤512px) and `<base>.thumb.webp` / `.thumb.avif`
  (≤96px). sharp `.rotate()` applies EXIF orientation and re-encoding strips
  EXIF/GPS by construction. AVIF is best-effort; the detail WebP is the
  rendition guaranteed to exist.
- **Storage MUST be a persistent volume.** `PRODUCT_IMAGE_STORAGE_DIR` points
  at the `myfinpro-<env>-products` volume in the compose files. Never let an
  image root default to the container filesystem in a deployment — blue/green
  swaps delete it (8.25-hotfix-2 post-mortem in `docs/phase-8-progress.md`).
- **Caps**: `PRODUCT_IMAGE_MAX_COUNT` (5) pictures per product;
  `position` is 1-based and contiguous, position 1 = the primary picture.
- **Self-healing**: one boot sweep re-enqueues regen jobs for rows missing
  thumbs. BullMQ custom job ids are dash-separated — **never put `:` in a
  jobId** (BullMQ ≥5 rejects it; a 3-part exception loophole made this fail
  silently and partially — see 8.25-hotfix-2).
- **Provenance is not stored.** An Open Food Facts prefill image
  (`addFromUrl`) becomes an ordinary row; the "official vs user photo"
  distinction exists only transiently in the create dialog. If a future
  feature needs provenance (badges, re-fetch), add a `source` column then —
  do not infer it from anything else.

## 2. Serving contract (catalog imagery)

`GET /products/:id/image` (primary shortcut) and
`GET /products/:id/images/:imageId` in `product.controller.ts`:

- **Auth: `CookieOrBearerAuthGuard`** (`auth/guards/`). Plain `<img>` tags
  cannot send `Authorization`; they ride the `access_token` cookie set at
  login/refresh. GET-only surfaces may use this guard; **mutations stay
  Bearer-only** (CSRF posture). Any module using the guard via `@UseGuards`
  must import `JwtConfigModule` (enhancers instantiate in the host module).
- **Query contract**: `?size=thumb|full` selects the rendition; `?v=<token>`
  is a cache-buster the client appends so URLs change when content changes —
  the server ignores it, but the DTO **must whitelist it** (the global
  `ValidationPipe` runs `forbidNonWhitelisted`; guards run before pipes, so
  an auth failure can mask a validation 400 — test the full real-world URL
  shape, query string included).
- **Negotiation & caching**: AVIF when `Accept` allows and the file exists,
  else WebP; `ETag` + `If-None-Match` → 304; `Vary: Accept`;
  `Cache-Control: private, max-age=86400`.

## 3. Private documents (receipt files)

`GET /receipts/:id/files/:fileId` stays **Bearer-only** and the web fetches
it as a blob (`fetchFileBlob` in `receipt-context.tsx`) rendered through
object URLs. No ETag/negotiation — receipts serve the single stored file
with `Cache-Control: private, max-age=3600`. This asymmetry is deliberate:
proving documents never become browser-cacheable URLs that outlive the
session, and PDFs need the blob path anyway. Post-CONFIRM, jpeg/png pages
are compacted to ≤2048px WebP by `ReceiptOptimizationService`.

## 4. Web building blocks

Reuse these — do not hand-roll new ones. All async operations follow
`docs/ui-async-conventions.md` (`useAsyncOperation`, no ad-hoc spinners).

| Concern                    | The one implementation                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pick / capture files       | `components/ui/FileCaptureButtons.tsx` — browse + camera pair                                                |
| Accept lists & size caps   | `lib/upload.ts` — `IMAGE_ACCEPT`, `RECEIPT_ACCEPT`, `validateUploadFiles()`                                  |
| Product image URL          | `useProducts().imageUrl(product, size?)` / `.productImageUrl(id, img, size?)` — both append `?v=`            |
| Product `<img>` + fallback | `components/product/ProductImage.tsx` — cube placeholder, `onError` swap                                     |
| Registry thumbnail         | `components/product/ProductThumb.tsx` (wraps `ProductImage` for receipt/transaction lines)                   |
| Gallery (server rows)      | `components/product/ProductGallery.tsx` — primary + thumb strip, add/remove/make-primary, lightbox           |
| Full-size viewer           | `components/ui/DocumentViewer.tsx` — zoom/pan/pager/PDF lightbox (portal, focus-trapped)                     |
| Product quick view         | `components/product/ProductQuickViewDialog.tsx` — read-only product popup with gallery                       |
| Staged local previews      | object-URL pattern (`URL.createObjectURL` + revoke on unmount) as in `ProductFormDialog` / `StagedPagesTray` |

Rules:

- **Client-side validation before upload.** Run `validateUploadFiles()`
  (type + size against the shared caps) and surface violations as toasts
  before any request; the server re-validates authoritatively.
- **Upload UX by context.** Edit contexts (product detail, edit dialog)
  upload immediately per file; create contexts (product form before the
  row exists, receipt staging tray) stage object-URL previews and submit
  together. Both show progress through `useAsyncOperation`.
- **Every product `<img>` goes through `ProductImage`** so the placeholder
  and error fallback stay identical everywhere.
- **Every full-size view goes through `DocumentViewer`** — images get
  zoom/pan, PDFs get `<object>` + download fallback, multi-page gets the
  pager. Product galleries pass API URLs (cookie auth); receipts pass blob
  object URLs.
- **i18n**: viewer strings live in `common.viewer`; upload-rejection toasts
  in `common.upload` (`rejectedType`/`rejectedSize`, formatted by
  `uploadRejectionMessage()` in `lib/upload.ts`); browse/camera wording in
  `receipts.upload` (`browse`/`camera`); picture management strings in
  `products.form` / `products.detail`; quick-view strings in
  `products.quickView`. Reuse keys — never duplicate a string under a new
  name for the same meaning.

## 5. Where images appear (map)

- **Products page** → `ProductCard` (full rendition, placeholder fallback).
- **Product detail page** → `ProductGallery` (view + manage + lightbox).
- **Product create/edit dialog** → staged strip + OFF prefill thumb
  (`ProductFormDialog`); shares accept/validation/i18n with the gallery.
- **Receipt review item cards / transaction purchase details** →
  `ProductThumb`; clicking a linked product's thumb opens
  `ProductQuickViewDialog` (gallery + registry facts + link to the page).
- **Receipt review / transaction documents** → blob preview +
  `DocumentViewer`.

## 6. Checklist for a new image feature

1. Catalog imagery or private document? (§ above decides delivery + auth.)
2. Server: rendition pipeline reuse? Persistent volume? Dash-separated job
   ids? DTO whitelists every query param the client sends?
3. Web: `FileCaptureButtons` + `lib/upload.ts` for intake;
   `ProductImage`/`DocumentViewer` for display; `useAsyncOperation` for
   progress; existing i18n keys.
4. Tests exercise the real URL shape (query params included) and the
   cookie-auth path for anything an `<img>` tag will request.
5. Update this document if you introduced a new pattern.
