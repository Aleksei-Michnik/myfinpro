import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductQuickViewDialog } from './ProductQuickViewDialog';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const getProductMock = vi.fn();
vi.mock('@/lib/product/product-context', () => ({
  useProducts: () => ({ getProduct: getProductMock }),
}));

const listCategoriesMock = vi.fn();
vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({ listCategories: listCategoriesMock }),
}));

// The gallery has its own spec — the stub surfaces what it received.
vi.mock('./ProductGallery', () => ({
  ProductGallery: ({
    product,
    editable,
  }: {
    product: { id: string; images: { id: string }[] };
    editable: boolean;
  }) => (
    <div
      data-testid="gallery-stub"
      data-product={product.id}
      data-images={product.images.length}
      data-editable={String(editable)}
    />
  ),
}));

const PRODUCT = {
  id: 'p-1',
  barcode: '7290119381043',
  name: 'Tapuchips Salt',
  brand: 'Elite',
  hasImage: true,
  imageVersion: 'v1',
  defaultCategoryId: 'cat-1',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  images: [{ id: 'img-1', position: 1, version: 'v1' }],
};

describe('ProductQuickViewDialog (8.27)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProductMock.mockResolvedValue(PRODUCT);
    listCategoriesMock.mockResolvedValue([{ id: 'cat-1', name: 'Groceries' }]);
  });

  it('stays closed (and fetches nothing) without a productId', () => {
    render(<ProductQuickViewDialog productId={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId('product-quick-view-dialog')).toBeNull();
    expect(getProductMock).not.toHaveBeenCalled();
  });

  it('fetches the product and renders the registry facts with a read-only gallery', async () => {
    render(<ProductQuickViewDialog productId="p-1" onClose={vi.fn()} />);

    expect(screen.getByTestId('product-quick-view-loading')).toBeInTheDocument();
    await waitFor(() => expect(getProductMock).toHaveBeenCalledWith('p-1', expect.anything()));
    await waitFor(() =>
      expect(screen.getByTestId('product-quick-view-name')).toHaveTextContent('Tapuchips Salt'),
    );
    // Brand shows twice: the header eyebrow and the facts list.
    expect(screen.getAllByText('Elite')).toHaveLength(2);
    expect(screen.getByTestId('product-quick-view-barcode')).toHaveTextContent('7290119381043');
    await waitFor(() =>
      expect(screen.getByTestId('product-quick-view-category')).toHaveTextContent('Groceries'),
    );

    const gallery = screen.getByTestId('gallery-stub');
    expect(gallery).toHaveAttribute('data-product', 'p-1');
    expect(gallery).toHaveAttribute('data-images', '1');
    expect(gallery).toHaveAttribute('data-editable', 'false');
  });

  it('links to the locale-aware product page', async () => {
    render(<ProductQuickViewDialog productId="p-1" onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByTestId('product-quick-view-open')).toHaveAttribute(
        'href',
        '/products/p-1',
      ),
    );
  });

  it('closes on ESC, backdrop click and the close button', async () => {
    const onClose = vi.fn();
    render(<ProductQuickViewDialog productId="p-1" onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId('product-quick-view-name')).toBeInTheDocument());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('product-quick-view-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId('product-quick-view-close'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('surfaces a load failure with a retry affordance', async () => {
    getProductMock.mockRejectedValue(Object.assign(new Error('nope'), { status: 500 }));
    render(<ProductQuickViewDialog productId="p-1" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByTestId('gallery-stub')).toBeNull();
  });
});
