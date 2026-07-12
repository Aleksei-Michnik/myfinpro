'use client';

// Phase 8 · Iteration 8.9 — the product catalog (design §5).
//
// Two views over one grid: without a query, the caller's purchased products
// (private layer — newest purchase first, cursor-paginated with stats);
// with a query, ranked global-registry search in any recorded language.
// Barcode scan-to-find and create-product ride the same page.

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BarcodeScannerDialog } from '@/components/product/BarcodeScannerDialog';
import { ProductCard } from '@/components/product/ProductCard';
import { ProductFormDialog } from '@/components/product/ProductFormDialog';
import { Button } from '@/components/ui/Button';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useToast } from '@/components/ui/Toast';
import { useRouter } from '@/i18n/navigation';
import { usePayments } from '@/lib/payment/payment-context';
import type { CategoryDto } from '@/lib/payment/types';
import { useProducts } from '@/lib/product/product-context';
import type { ProductSummary } from '@/lib/product/types';
import { useAsyncOperation } from '@/lib/ui';

const SEARCH_DEBOUNCE_MS = 300;

export function ProductsClient() {
  const t = useTranslations('products');
  const locale = useLocale();
  const router = useRouter();
  const { fetchProducts, lookupBarcode } = useProducts();
  const { listCategories } = usePayments();
  const { addToast } = useToast();

  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBarcode, setCreateBarcode] = useState<string | undefined>(undefined);

  const listOp = useAsyncOperation<ProductSummary[]>({ scope: 'container' });
  const moreOp = useAsyncOperation<ProductSummary[]>({ scope: 'control' });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    (query: string) => {
      void listOp
        .run(async (signal) => {
          const page = await fetchProducts(query ? { search: query } : { limit: 24 }, signal);
          setNextCursor(page.nextCursor);
          return page.data;
        })
        .then((data) => {
          if (data !== undefined) setProducts(data);
        });
      // listOp identity is stable (useAsyncOperation contract).
    },
    [fetchProducts],
  );

  useEffect(() => {
    load(activeQuery);
  }, [load, activeQuery]);

  useEffect(() => {
    void listCategories({ direction: 'OUT' })
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [listCategories]);

  const onSearchInput = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setActiveQuery(value.trim().length >= 2 ? value.trim() : '');
    }, SEARCH_DEBOUNCE_MS);
  };

  const loadMore = () => {
    if (!nextCursor) return;
    void moreOp
      .run(async (signal) => {
        const page = await fetchProducts({ limit: 24, cursor: nextCursor }, signal);
        setNextCursor(page.nextCursor);
        return page.data;
      })
      .then((data) => {
        if (data !== undefined) {
          setProducts((prev) => {
            const known = new Set(prev.map((p) => p.id));
            return [...prev, ...data.filter((p) => !known.has(p.id))];
          });
        }
      });
  };

  const onScanDetected = (code: string) => {
    void lookupBarcode(code)
      .then((res) => {
        if (res.found && res.product) {
          router.push(`/products/${res.product.id}`);
          return;
        }
        setCreateBarcode(code);
        setCreateOpen(true);
      })
      .catch(() => addToast('error', t('list.lookupFailed')));
  };

  return (
    <main className="container mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setScannerOpen(true)}
            data-testid="products-scan"
          >
            {t('list.scan')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              setCreateBarcode(undefined);
              setCreateOpen(true);
            }}
            data-testid="products-create"
          >
            {t('list.create')}
          </Button>
        </div>
      </div>

      <search role="search">
        <label htmlFor="products-search" className="sr-only">
          {t('list.searchLabel')}
        </label>
        <input
          id="products-search"
          type="search"
          value={search}
          onChange={(e) => onSearchInput(e.target.value)}
          placeholder={t('list.searchPlaceholder')}
          autoComplete="off"
          data-testid="products-search"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </search>

      {listOp.error && listOp.error.reason !== 'aborted' ? (
        <InlineErrorBanner
          reason={listOp.error.reason}
          httpStatus={listOp.error.httpStatus}
          onRetry={() => load(activeQuery)}
        />
      ) : listOp.isLoading && products.length === 0 ? (
        // Skeleton grid — same cell geometry as the loaded cards (no CLS).
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          role="status"
          aria-label={t('list.loading')}
          data-testid="products-loading"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl bg-gray-100 motion-reduce:animate-none dark:bg-gray-800"
            />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400"
          data-testid="products-empty"
        >
          {activeQuery ? t('list.noResults', { query: activeQuery }) : t('list.empty')}
        </div>
      ) : (
        <>
          <p aria-live="polite" className="sr-only">
            {t('list.resultCount', { count: products.length })}
          </p>
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
            data-testid="products-grid"
          >
            {products.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} locale={locale} />
              </li>
            ))}
          </ul>
          {nextCursor && !activeQuery && (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={loadMore}
                disabled={moreOp.isLoading}
                data-testid="products-load-more"
              >
                {t('list.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}

      <BarcodeScannerDialog
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={onScanDetected}
      />
      <ProductFormDialog
        open={createOpen}
        initialBarcode={createBarcode}
        categories={categories}
        onCancel={() => setCreateOpen(false)}
        onSaved={(product) => {
          setCreateOpen(false);
          router.push(`/products/${product.id}`);
        }}
      />
    </main>
  );
}
