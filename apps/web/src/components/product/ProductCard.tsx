'use client';

// Phase 8 · Iteration 8.9 — one catalog cell. The whole card is a single
// link (one tab stop), image is lazy + async-decoded with a fixed aspect
// box so the grid never shifts, and the purchase stats come from the
// caller-scoped private layer.

import { useTranslations } from 'next-intl';
import { ProductImage } from '@/components/product/ProductImage';
import { Link } from '@/i18n/navigation';
import { useProducts } from '@/lib/product/product-context';
import type { ProductSummary } from '@/lib/product/types';

function formatMoney(cents: number, currency: string | null, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency ?? 'USD' }).format(
      cents / 100,
    );
  } catch {
    return (cents / 100).toFixed(2);
  }
}

export function ProductCard({ product, locale }: { product: ProductSummary; locale: string }) {
  const t = useTranslations('products.card');
  const { imageUrl } = useProducts();

  return (
    <Link
      href={`/products/${product.id}`}
      data-testid={`product-card-${product.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-reduce:transition-none dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex aspect-square items-center justify-center bg-gray-50 dark:bg-gray-900/40">
        {/* Authenticated API endpoint + blob-free <img>; ?v= busts on re-upload. */}
        <ProductImage
          src={product.hasImage ? imageUrl(product) : null}
          className="h-full w-full object-contain"
          placeholderClassName="h-10 w-10"
        />
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-3">
        {product.brand && (
          <p className="truncate text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {product.brand}
          </p>
        )}
        <p className="line-clamp-2 text-sm font-medium text-gray-900 group-hover:text-primary-700 dark:text-gray-100 dark:group-hover:text-primary-300">
          {product.name}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-gray-500 dark:text-gray-400">
          {product.stats && product.stats.timesPurchased > 0 ? (
            <span>{t('timesPurchased', { count: product.stats.timesPurchased })}</span>
          ) : (
            <span aria-hidden="true" />
          )}
          {product.stats?.lastUnitPriceCents != null && (
            <span className="font-medium tabular-nums text-gray-700 dark:text-gray-300">
              {formatMoney(product.stats.lastUnitPriceCents, product.stats.lastCurrency, locale)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
