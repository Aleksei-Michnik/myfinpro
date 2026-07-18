'use client';

// 8.24 (extracted from the review client, introduced in 8.23) — the registry
// thumbnail of a receipt line's linked product: the processed image when one
// exists, the cube placeholder otherwise (unmatched items, load errors).

import { ProductImage } from '@/components/product/ProductImage';
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
  const src =
    item?.productId && item.productHasImage
      ? imageUrl({ id: item.productId, imageVersion: item.productImageVersion }, 'thumb')
      : null;
  return (
    <ProductImage
      src={src}
      className={`${sizeClass} shrink-0 rounded object-cover`}
      placeholderClassName={`${sizeClass} shrink-0`}
      placeholderTestId="product-thumb-placeholder"
    />
  );
}
