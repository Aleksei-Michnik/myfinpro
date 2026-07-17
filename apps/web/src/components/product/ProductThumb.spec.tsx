import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductThumb } from './ProductThumb';
import type { ReceiptItem } from '@/lib/receipt/types';

vi.mock('@/lib/product/product-context', () => ({
  useProducts: () => ({
    imageUrl: (p: { id: string; imageVersion: string | null }, size?: string) =>
      `/api/v1/products/${p.id}/image?size=${size ?? 'full'}${p.imageVersion ? `&v=${p.imageVersion}` : ''}`,
  }),
}));

type ThumbItem = Pick<ReceiptItem, 'productId' | 'productHasImage' | 'productImageVersion'>;

const matched: ThumbItem = { productId: 'p-1', productHasImage: true, productImageVersion: 'v42' };

describe('ProductThumb (8.24)', () => {
  it('renders the registry image for a linked product with an image', () => {
    const { container } = render(<ProductThumb item={matched} />);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/v1/products/p-1/image?size=thumb&v=v42',
    );
    expect(screen.queryByTestId('product-thumb-placeholder')).toBeNull();
  });

  it('applies the sizeClass to the image (card header size)', () => {
    const { container } = render(<ProductThumb item={matched} sizeClass="h-12 w-12" />);
    expect(container.querySelector('img')?.className).toContain('h-12 w-12');
  });

  it('shows the cube placeholder when the item is unmatched', () => {
    render(
      <ProductThumb
        item={{ productId: null, productHasImage: false, productImageVersion: null }}
      />,
    );
    expect(screen.getByTestId('product-thumb-placeholder')).toBeInTheDocument();
  });

  it('shows the cube placeholder when no item is given at all', () => {
    render(<ProductThumb sizeClass="h-12 w-12" />);
    expect(screen.getByTestId('product-thumb-placeholder').getAttribute('class')).toContain(
      'h-12 w-12',
    );
  });

  it('shows the placeholder when the linked product has no image', () => {
    render(<ProductThumb item={{ ...matched, productHasImage: false }} />);
    expect(screen.getByTestId('product-thumb-placeholder')).toBeInTheDocument();
  });

  it('falls back to the placeholder on an image load error', () => {
    const { container } = render(<ProductThumb item={matched} />);
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByTestId('product-thumb-placeholder')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
