'use client';

// Phase 8 · Iteration 8.9 — product detail: registry data (image, names,
// aliases with locale tags, barcode, default category) + the CALLER's
// purchase history and per-merchant price summary (private layer, design
// §1.1). Registry edits, alias add, image upload and barcode attach all
// live here.

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProductFormDialog } from '@/components/product/ProductFormDialog';
import { Button } from '@/components/ui/Button';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useToast } from '@/components/ui/Toast';
import { Link } from '@/i18n/navigation';
import { usePayments } from '@/lib/payment/payment-context';
import type { CategoryDto } from '@/lib/payment/types';
import { useProducts } from '@/lib/product/product-context';
import type { ProductPurchasesResponse, ProductSummary } from '@/lib/product/types';
import { useAsyncOperation } from '@/lib/ui';

function formatMoney(cents: number | null, currency: string | null, locale: string): string {
  if (cents === null) return '—';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency ?? 'USD' }).format(
      cents / 100,
    );
  } catch {
    return (cents / 100).toFixed(2);
  }
}

function formatWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

export function ProductDetailClient({ productId }: { productId: string }) {
  const t = useTranslations('products.detail');
  const locale = useLocale();
  const { getProduct, fetchPurchases, addAlias, uploadImage, imageUrl } = useProducts();
  const { listCategories } = usePayments();
  const { addToast } = useToast();

  const [product, setProduct] = useState<ProductSummary | null>(null);
  const [purchases, setPurchases] = useState<ProductPurchasesResponse | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [aliasText, setAliasText] = useState('');
  const [imageFailed, setImageFailed] = useState(false);

  const loadOp = useAsyncOperation<ProductSummary>({ scope: 'container' });
  const actOp = useAsyncOperation<boolean>({ scope: 'control' });
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    void loadOp
      .run((signal) => getProduct(productId, signal))
      .then((fresh) => {
        if (fresh !== undefined) setProduct(fresh);
      });
    void fetchPurchases(productId)
      .then(setPurchases)
      .catch(() => setPurchases(null));
    // loadOp identity is stable (useAsyncOperation contract).
  }, [getProduct, fetchPurchases, productId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void listCategories({ direction: 'OUT' })
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [listCategories]);

  useEffect(() => {
    if (actOp.error && actOp.error.reason !== 'aborted') {
      addToast('error', actOp.error.message || t('actionFailed'));
    }
  }, [actOp.error, addToast, t]);

  const submitAlias = () => {
    const name = aliasText.trim();
    if (!name || !product) return;
    void actOp
      .run(async (signal) => {
        const fresh = await addAlias(product.id, { name, locale }, signal);
        setProduct(fresh);
        return true;
      })
      .then((r) => {
        if (r !== undefined) {
          setAliasText('');
          addToast('success', t('aliasAddedToast'));
        }
      });
  };

  const onImagePicked = (file: File | undefined) => {
    if (!file || !product) return;
    void actOp
      .run(async (signal) => {
        await uploadImage(product.id, file, signal);
        return true;
      })
      .then((r) => {
        if (r !== undefined) addToast('success', t('imageQueuedToast'));
      });
  };

  const defaultCategoryName =
    product?.defaultCategoryId != null
      ? (categories.find((c) => c.id === product.defaultCategoryId)?.name ?? null)
      : null;

  if (loadOp.error && !product) {
    const notFound = loadOp.error.httpStatus === 404;
    return (
      <main className="container mx-auto max-w-lg px-4 py-8">
        <div
          className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
          role="alert"
          data-testid="product-detail-error"
        >
          <h1 className="mb-3 text-xl font-semibold text-gray-900 dark:text-gray-100">
            {notFound ? t('notFound') : t('loadFailed')}
          </h1>
          {!notFound && (
            <InlineErrorBanner
              reason={loadOp.error.reason}
              httpStatus={loadOp.error.httpStatus}
              onRetry={load}
            />
          )}
          <Link
            href="/products"
            className="mt-3 inline-block text-sm text-primary-700 hover:underline dark:text-primary-300"
            data-testid="product-detail-back"
          >
            ← {t('back')}
          </Link>
        </div>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-8">
        <div
          className="flex items-center justify-center py-16"
          role="status"
          aria-label={t('loading')}
          data-testid="product-detail-loading"
        >
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600 motion-reduce:animate-none" />
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-4xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/products"
          className="text-sm text-primary-700 hover:underline dark:text-primary-300"
          data-testid="product-detail-back"
        >
          ← {t('back')}
        </Link>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditOpen(true)}
          data-testid="product-detail-edit"
        >
          {t('edit')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[200px_1fr]">
        {/* ── Image ──────────────────────────────────────────────────── */}
        <section
          aria-label={t('imageTitle')}
          className="space-y-2"
          data-testid="product-detail-image"
        >
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
            {product.hasImage && !imageFailed ? (
              <img
                src={imageUrl(product)}
                alt={product.name}
                decoding="async"
                onError={() => setImageFailed(true)}
                className="h-full w-full object-contain"
              />
            ) : (
              <svg
                className="h-12 w-12 text-gray-300 dark:text-gray-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
                />
              </svg>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            className="hidden"
            onChange={(e) => onImagePicked(e.target.files?.[0])}
            data-testid="product-detail-image-input"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={actOp.isLoading}
            className="w-full"
            data-testid="product-detail-image-upload"
          >
            {t('uploadImage')}
          </Button>
        </section>

        {/* ── Registry data ──────────────────────────────────────────── */}
        <section className="space-y-3">
          <div>
            {product.brand && (
              <p className="text-sm uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {product.brand}
              </p>
            )}
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{product.name}</h1>
          </div>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-gray-500 dark:text-gray-400">{t('barcodeLabel')}</dt>
              <dd
                className="font-mono text-gray-900 dark:text-gray-100"
                data-testid="product-detail-barcode"
              >
                {product.barcode ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500 dark:text-gray-400">{t('categoryLabel')}</dt>
              <dd className="text-gray-900 dark:text-gray-100">{defaultCategoryName ?? '—'}</dd>
            </div>
            {product.stats && (
              <>
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">
                    {t('timesPurchasedLabel')}
                  </dt>
                  <dd className="text-gray-900 dark:text-gray-100">
                    {product.stats.timesPurchased}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">
                    {t('lastPurchasedLabel')}
                  </dt>
                  <dd className="text-gray-900 dark:text-gray-100">
                    {product.stats.lastPurchasedAt
                      ? formatWhen(product.stats.lastPurchasedAt, locale)
                      : '—'}
                  </dd>
                </div>
              </>
            )}
          </dl>

          {/* Aliases */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t('aliasesTitle')}
            </h2>
            {product.aliases && product.aliases.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" data-testid="product-detail-aliases">
                {product.aliases.map((alias) => (
                  <li
                    key={alias.id}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                    title={t('aliasConfirmations', { count: alias.confirmationCount })}
                  >
                    <span dir="auto">{alias.name}</span>
                    {alias.locale && (
                      <span className="uppercase text-gray-400 dark:text-gray-500">
                        {alias.locale}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('noAliases')}</p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitAlias();
              }}
              className="flex gap-2"
            >
              <label htmlFor="product-alias-input" className="sr-only">
                {t('aliasLabel')}
              </label>
              <input
                id="product-alias-input"
                type="text"
                value={aliasText}
                onChange={(e) => setAliasText(e.target.value)}
                placeholder={t('aliasPlaceholder')}
                maxLength={300}
                data-testid="product-detail-alias-input"
                className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={actOp.isLoading || !aliasText.trim()}
                data-testid="product-detail-alias-add"
              >
                {t('aliasAdd')}
              </Button>
            </form>
          </div>
        </section>
      </div>

      {/* ── Per-merchant prices (caller's data only) ─────────────────── */}
      {purchases && purchases.merchants.length > 0 && (
        <section
          aria-labelledby="product-merchants-title"
          className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
        >
          <h2
            id="product-merchants-title"
            className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100"
          >
            {t('merchantsTitle')}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="product-detail-merchants">
              <thead>
                <tr className="border-b border-gray-200 text-start text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th scope="col" className="py-1.5 pe-3 text-start font-medium">
                    {t('merchantCol')}
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-end font-medium">
                    {t('purchasesCol')}
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-end font-medium">
                    {t('lastPriceCol')}
                  </th>
                  <th scope="col" className="ps-3 py-1.5 text-end font-medium">
                    {t('priceRangeCol')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {purchases.merchants.map((m, i) => (
                  <tr
                    key={`${m.merchantName ?? ''}-${i}`}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-700/50"
                  >
                    <td className="py-1.5 pe-3 text-gray-900 dark:text-gray-100">
                      {m.merchantName ?? t('unknownMerchant')}
                    </td>
                    <td className="px-3 py-1.5 text-end tabular-nums text-gray-700 dark:text-gray-300">
                      {m.purchases}
                    </td>
                    <td className="px-3 py-1.5 text-end tabular-nums text-gray-900 dark:text-gray-100">
                      {formatMoney(
                        m.lastUnitPriceCents,
                        purchases.purchases[0]?.currency ?? null,
                        locale,
                      )}
                    </td>
                    <td className="ps-3 py-1.5 text-end tabular-nums text-gray-500 dark:text-gray-400">
                      {m.minUnitPriceCents !== null && m.maxUnitPriceCents !== null
                        ? `${formatMoney(m.minUnitPriceCents, purchases.purchases[0]?.currency ?? null, locale)} – ${formatMoney(m.maxUnitPriceCents, purchases.purchases[0]?.currency ?? null, locale)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Purchase history ─────────────────────────────────────────── */}
      <section
        aria-labelledby="product-purchases-title"
        className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
      >
        <h2
          id="product-purchases-title"
          className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          {t('purchasesTitle')}
        </h2>
        {purchases && purchases.purchases.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="product-detail-purchases">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th scope="col" className="py-1.5 pe-3 text-start font-medium">
                    {t('dateCol')}
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-start font-medium">
                    {t('merchantCol')}
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-end font-medium">
                    {t('qtyCol')}
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-end font-medium">
                    {t('unitPriceCol')}
                  </th>
                  <th scope="col" className="ps-3 py-1.5 text-end font-medium">
                    {t('totalCol')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {purchases.purchases.map((row, i) => (
                  <tr
                    key={`${row.receiptId}-${i}`}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-700/50"
                  >
                    <td className="py-1.5 pe-3 text-gray-900 dark:text-gray-100">
                      <Link
                        href={`/receipts/${row.receiptId}`}
                        className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
                      >
                        {formatWhen(row.purchasedAt, locale)}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">
                      {row.merchantName ?? t('unknownMerchant')}
                    </td>
                    <td className="px-3 py-1.5 text-end tabular-nums text-gray-700 dark:text-gray-300">
                      {row.quantity}
                    </td>
                    <td className="px-3 py-1.5 text-end tabular-nums text-gray-700 dark:text-gray-300">
                      {formatMoney(row.unitPriceCents, row.currency, locale)}
                    </td>
                    <td className="ps-3 py-1.5 text-end tabular-nums font-medium text-gray-900 dark:text-gray-100">
                      {formatMoney(row.totalCents, row.currency, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p
            className="text-sm text-gray-500 dark:text-gray-400"
            data-testid="product-detail-no-purchases"
          >
            {t('noPurchases')}
          </p>
        )}
      </section>

      <ProductFormDialog
        open={editOpen}
        product={product}
        categories={categories}
        onCancel={() => setEditOpen(false)}
        onSaved={(fresh) => {
          setEditOpen(false);
          setProduct((prev) => ({ ...prev, ...fresh, aliases: prev?.aliases ?? fresh.aliases }));
        }}
      />
    </main>
  );
}
