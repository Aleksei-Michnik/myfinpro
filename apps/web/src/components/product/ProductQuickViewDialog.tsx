'use client';

// Phase 8.27 — read-only product popup (docs/image-handling.md §5): opened
// from a receipt item card's / purchase-details line's product thumbnail.
// Shows the gallery plus the registry facts (name, brand, barcode, default
// category) and links to the full product page. Dialog semantics follow
// AttachReceiptDialog: portal, backdrop, ESC close, focus moved in on open.

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ProductGallery } from '@/components/product/ProductGallery';
import { Dialog } from '@/components/ui/Dialog';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { Link } from '@/i18n/navigation';
import { useProducts } from '@/lib/product/product-context';
import type { ProductSummary } from '@/lib/product/types';
import { useTransactions } from '@/lib/transaction/transaction-context';
import type { CategoryDto } from '@/lib/transaction/types';
import { useAsyncOperation, useBodyScrollLock } from '@/lib/ui';

export interface ProductQuickViewDialogProps {
  /** Product to show; null keeps the dialog closed. */
  productId: string | null;
  onClose(): void;
}

export function ProductQuickViewDialog({ productId, onClose }: ProductQuickViewDialogProps) {
  const t = useTranslations('products.quickView');
  const tDetail = useTranslations('products.detail');
  const tForm = useTranslations('products.form');
  const { getProduct } = useProducts();
  const { listCategories } = useTransactions();

  const [product, setProduct] = useState<ProductSummary | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const loadOp = useAsyncOperation<ProductSummary>({ scope: 'container' });

  const open = productId !== null;
  useBodyScrollLock(open);

  const load = useCallback(() => {
    if (!productId) return;
    void loadOp
      .run((signal) => getProduct(productId, signal))
      .then((fresh) => {
        if (fresh !== undefined) setProduct(fresh);
      });
    // loadOp identity is stable (useAsyncOperation contract).
  }, [getProduct, productId]);

  useEffect(() => {
    if (!open) return;
    setProduct(null);
    load();
  }, [open, load]);

  // The default-category name resolves against the visible OUT categories
  // (same source as the detail page).
  useEffect(() => {
    if (!open) return;
    void listCategories({ direction: 'OUT' })
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [open, listCategories]);

  if (!open || typeof document === 'undefined') return null;

  const defaultCategoryName =
    product?.defaultCategoryId != null
      ? (categories.find((c) => c.id === product.defaultCategoryId)?.name ?? null)
      : null;

  // Taller than the viewport? The PANEL scrolls (max-h + overflow-y in
  // <Dialog>) — never the body, which useBodyScrollLock freezes while open.
  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="product-quick-view-title"
      testId="product-quick-view-dialog"
      backdropTestId="product-quick-view-backdrop"
      className="flex flex-col gap-3 border border-gray-200 dark:border-gray-700"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {product?.brand && (
            <p className="truncate text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {product.brand}
            </p>
          )}
          <h2
            id="product-quick-view-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            data-testid="product-quick-view-name"
          >
            {product?.name ?? t('title')}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          data-testid="product-quick-view-close"
          className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {product ? (
        <>
          <ProductGallery
            product={{ id: product.id, name: product.name, images: product.images ?? [] }}
            editable={false}
          />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {product.brand && (
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">{tForm('brandLabel')}</dt>
                <dd className="text-gray-900 dark:text-gray-100">{product.brand}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-gray-500 dark:text-gray-400">
                {tDetail('barcodeLabel')}
              </dt>
              <dd
                className="font-mono text-gray-900 dark:text-gray-100"
                data-testid="product-quick-view-barcode"
              >
                {product.barcode ?? '—'}
              </dd>
            </div>
            {defaultCategoryName && (
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">
                  {tDetail('categoryLabel')}
                </dt>
                <dd
                  className="text-gray-900 dark:text-gray-100"
                  data-testid="product-quick-view-category"
                >
                  {defaultCategoryName}
                </dd>
              </div>
            )}
          </dl>
          <Link
            href={`/products/${product.id}`}
            className="text-sm text-primary-700 hover:underline dark:text-primary-300"
            data-testid="product-quick-view-open"
          >
            {t('openProduct')} →
          </Link>
        </>
      ) : loadOp.error && loadOp.error.reason !== 'aborted' ? (
        <InlineErrorBanner
          reason={loadOp.error.reason}
          httpStatus={loadOp.error.httpStatus}
          onRetry={load}
        />
      ) : (
        <div
          className="flex items-center justify-center py-10"
          role="status"
          aria-label={tDetail('loading')}
          data-testid="product-quick-view-loading"
        >
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600 motion-reduce:animate-none" />
        </div>
      )}
    </Dialog>
  );
}
