'use client';

// 8.24 (extracted from the review client, introduced in 8.23) — the registry
// thumbnail of a receipt line's linked product: the processed image when one
// exists, the cube placeholder otherwise (unmatched items, load errors).

import { useState } from 'react';
import { useProducts } from '@/lib/product/product-context';
import type { ReceiptItem } from '@/lib/receipt/types';

export interface ProductThumbProps {
  /** Registry link of a receipt line — placeholder when absent or unmatched. */
  item?: Pick<ReceiptItem, 'productId' | 'productHasImage' | 'productImageVersion'>;
  /** Tailwind size: `h-5 w-5` row-chip default; the item card header uses `h-12 w-12`. */
  sizeClass?: string;
}

export function ProductThumb({ item, sizeClass = 'h-5 w-5' }: ProductThumbProps) {
  const { imageUrl } = useProducts();
  const [failed, setFailed] = useState(false);
  if (!item?.productId || !item.productHasImage || failed) {
    return (
      <svg
        className={`${sizeClass} shrink-0 text-gray-300 dark:text-gray-600`}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
        data-testid="product-thumb-placeholder"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
        />
      </svg>
    );
  }
  return (
    <img
      src={imageUrl({ id: item.productId, imageVersion: item.productImageVersion }, 'thumb')}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`${sizeClass} shrink-0 rounded object-cover`}
    />
  );
}
