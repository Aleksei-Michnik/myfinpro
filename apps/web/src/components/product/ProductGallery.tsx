'use client';

// Phase 8.27 — THE gallery over a product's server-side pictures
// (docs/image-handling.md §4): selected picture large (swipe / arrow keys /
// thumb clicks move the selection, WAI-ARIA carousel semantics), thumb strip
// below, full-size lightbox via the shared DocumentViewer. When editable it
// also manages the pictures — add (immediate upload), remove behind a
// ConfirmDialog, make-primary — and reports every mutation to the parent
// via onChanged (the gallery never fetches; the parent owns the product row).

import {
  PRODUCT_IMAGE_MAX_COUNT,
  PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES,
  type ProductImageInfo,
} from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ProductImage } from '@/components/product/ProductImage';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DocumentViewer } from '@/components/ui/DocumentViewer';
import { FileCaptureButtons } from '@/components/ui/FileCaptureButtons';
import { useToast } from '@/components/ui/Toast';
import { useProducts } from '@/lib/product/product-context';
import { arrowKeyDelta, swipeDelta } from '@/lib/swipe';
import { useAsyncOperation } from '@/lib/ui';
import { IMAGE_ACCEPT, uploadRejectionMessage, validateUploadFiles } from '@/lib/upload';

/** The primary-picture star — the make-primary action and the static badge. */
function StarIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9L10 1.5z" />
    </svg>
  );
}

export interface ProductGalleryProps {
  /** Detail-read product row — `images` in display order (position 1 = primary). */
  product: { id: string; name: string; images: ProductImageInfo[] };
  editable: boolean;
  /** Fired after any successful mutation — the parent refetches the product. */
  onChanged?(): void;
}

export function ProductGallery({ product, editable, onChanged }: ProductGalleryProps) {
  const t = useTranslations('products.form');
  const tDetail = useTranslations('products.detail');
  const tCommon = useTranslations('common');
  const tUpload = useTranslations('common.upload');
  // Camera label rides the intake-zone key — same wording everywhere.
  const uploadT = useTranslations('receipts.upload');
  const { uploadImage, removeImage, reorderImage, productImageUrl } = useProducts();
  const { addToast } = useToast();

  const images = product.images;
  // Selection is by id so it survives reorders; a removed/unknown id falls
  // back to the primary picture (position 1, first in the ordered list).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Removal is destructive → confirmed through the shared ConfirmDialog.
  const [removeCandidateId, setRemoveCandidateId] = useState<string | null>(null);
  const op = useAsyncOperation<boolean>({ scope: 'control' });

  // Swipe tracking on the main picture; a completed swipe suppresses the
  // click that follows it so it never doubles as click-to-lightbox.
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  const selectedIndex = Math.max(
    0,
    images.findIndex((img) => img.id === selectedId),
  );
  const selected = images[selectedIndex] ?? null;
  const swipeable = images.length > 1;

  /** Move the selection by delta, stopping at the ends (no wrap-around). */
  const stepSelection = (delta: -1 | 1) => {
    const next = images[Math.min(images.length - 1, Math.max(0, selectedIndex + delta))];
    if (next) setSelectedId(next.id);
  };

  useEffect(() => {
    if (op.error && op.error.reason !== 'aborted') {
      addToast('error', op.error.message || t('pictureUploadFailed'));
    }
  }, [op.error, addToast, t]);

  const onPictures = (files: File[]) => {
    const { accepted, rejected } = validateUploadFiles(files, {
      accept: IMAGE_ACCEPT,
      maxBytes: PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES,
    });
    for (const rejection of rejected) {
      addToast(
        'error',
        uploadRejectionMessage(tUpload, rejection, PRODUCT_IMAGE_MAX_FILE_SIZE_BYTES),
      );
    }
    const batch = accepted.slice(0, PRODUCT_IMAGE_MAX_COUNT - images.length);
    if (batch.length === 0) return;
    void op
      .run(async (signal) => {
        for (const file of batch) {
          await uploadImage(product.id, file, signal);
        }
        return true;
      })
      .then((r) => {
        if (r !== undefined) {
          addToast('success', tDetail('imageQueuedToast'));
          onChanged?.();
        }
      });
  };

  const onRemoveConfirmed = (imageId: string) => {
    void op
      .run(async (signal) => {
        await removeImage(product.id, imageId, signal);
        return true;
      })
      .then((r) => {
        if (r !== undefined) {
          setRemoveCandidateId(null);
          onChanged?.();
        }
      });
  };

  const onMakePrimary = (imageId: string) => {
    void op
      .run(async (signal) => {
        await reorderImage(product.id, imageId, 1, signal);
        return true;
      })
      .then((r) => {
        if (r !== undefined) onChanged?.();
      });
  };

  // WAI-ARIA carousel: swipe (touch AND mouse drag) or arrow keys move the
  // selection; both invert under RTL (see lib/swipe.ts). Vertical page
  // scrolling stays native (`touch-action: pan-y` + dominance check).
  const onMainPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!swipeable) return;
    swipeStartRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMainPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const delta = swipeDelta(e.currentTarget, e.clientX - start.x, e.clientY - start.y);
    if (delta === 0) return;
    suppressClickRef.current = true;
    stepSelection(delta);
  };
  const onMainKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!swipeable) return;
    const delta = arrowKeyDelta(e.currentTarget, e.key);
    if (delta === 0) return;
    e.preventDefault();
    stepSelection(delta);
  };

  return (
    <div
      className="space-y-2"
      role="group"
      aria-roledescription={tDetail('carousel')}
      aria-label={product.name}
      data-testid="product-gallery"
    >
      {/* ── Main picture (click → lightbox; swipe/arrows → next/prev) ── */}
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
        {selected ? (
          <button
            type="button"
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              setLightboxOpen(true);
            }}
            onPointerDown={onMainPointerDown}
            onPointerUp={onMainPointerUp}
            onPointerCancel={() => {
              swipeStartRef.current = null;
            }}
            onKeyDown={onMainKeyDown}
            style={swipeable ? { touchAction: 'pan-y' } : undefined}
            data-testid="product-gallery-main"
            className="block h-full w-full cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <ProductImage
              src={productImageUrl(product.id, selected)}
              alt={product.name}
              className="h-full w-full object-contain"
              placeholderClassName="mx-auto h-12 w-12"
            />
          </button>
        ) : (
          <ProductImage src={null} placeholderClassName="h-12 w-12" />
        )}
      </div>

      {/* Position announcement for AT while swiping/arrowing through. */}
      {swipeable && (
        <span className="sr-only" aria-live="polite" data-testid="product-gallery-position">
          {tDetail('pictureOf', { current: selectedIndex + 1, total: images.length })}
        </span>
      )}

      {/* ── Thumb strip ────────────────────────────────────────────────── */}
      {images.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="product-gallery-thumbs">
          {images.map((img, index) => {
            // The ring marks the SELECTION; the primary picture carries a
            // static star badge instead.
            const frameClass =
              index === selectedIndex
                ? 'ring-2 ring-primary-500'
                : 'border border-gray-200 dark:border-gray-600';
            return (
              <div key={img.id} className="relative">
                <button
                  type="button"
                  onClick={() => setSelectedId(img.id)}
                  aria-current={index === selectedIndex || undefined}
                  data-testid={`product-gallery-thumb-${index}`}
                  className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
                >
                  <ProductImage
                    src={productImageUrl(product.id, img, 'thumb')}
                    alt={product.name}
                    className={`h-14 w-14 rounded-md object-cover ${frameClass}`}
                    placeholderClassName={`h-14 w-14 rounded-md ${frameClass}`}
                  />
                </button>
                {img.position === 1 ? (
                  <span
                    aria-hidden="true"
                    title={tDetail('primaryPicture')}
                    data-testid={`product-gallery-primary-badge-${index}`}
                    className="absolute -bottom-1 -start-1 rounded-full bg-white p-0.5 text-primary-600 shadow dark:bg-gray-700 dark:text-primary-400"
                  >
                    <StarIcon />
                  </span>
                ) : (
                  editable && (
                    <button
                      type="button"
                      aria-label={t('makePrimary')}
                      title={t('makePrimary')}
                      disabled={op.isLoading}
                      onClick={() => onMakePrimary(img.id)}
                      data-testid={`product-gallery-primary-${index}`}
                      className="absolute -bottom-1 -start-1 rounded-full bg-white p-0.5 text-gray-500 shadow hover:text-primary-600 dark:bg-gray-700 dark:text-gray-300"
                    >
                      <StarIcon />
                    </button>
                  )
                )}
                {editable && (
                  <button
                    type="button"
                    aria-label={t('removePicture')}
                    disabled={op.isLoading}
                    onClick={() => setRemoveCandidateId(img.id)}
                    data-testid={`product-gallery-remove-${index}`}
                    className="absolute -end-1 -top-1 rounded-full bg-white p-0.5 text-gray-500 shadow hover:text-red-600 dark:bg-gray-700 dark:text-gray-300"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add pictures (edit context: immediate upload) ──────────────── */}
      {editable && images.length < PRODUCT_IMAGE_MAX_COUNT && (
        <div className="flex flex-wrap items-center gap-2">
          <FileCaptureButtons
            accept={IMAGE_ACCEPT}
            multiple
            disabled={op.isLoading}
            onFiles={onPictures}
            browseLabel={t('addPicture')}
            cameraLabel={uploadT('camera')}
            testIdPrefix="product-gallery"
            variant="outline"
          />
        </div>
      )}

      {/* Destructive — one accidental tap must never delete a picture. */}
      {removeCandidateId && (
        <ConfirmDialog
          title={t('removePicture')}
          message={tDetail('removePictureConfirm')}
          confirmLabel={tCommon('delete')}
          cancelLabel={tCommon('cancel')}
          danger
          busy={op.isLoading}
          onConfirm={() => onRemoveConfirmed(removeCandidateId)}
          onClose={() => setRemoveCandidateId(null)}
        />
      )}

      <DocumentViewer
        open={lightboxOpen}
        pages={images.map((img) => ({
          kind: 'image' as const,
          src: productImageUrl(product.id, img),
        }))}
        initialIndex={selectedIndex}
        title={product.name}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}
