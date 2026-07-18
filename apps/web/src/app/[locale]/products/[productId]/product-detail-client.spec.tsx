import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductDetailClient } from './product-detail-client';
import type { ProductSummary } from '@/lib/product/types';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
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
const fetchPurchasesMock = vi.fn();
const addAliasMock = vi.fn();
vi.mock('@/lib/product/product-context', () => ({
  useProducts: () => ({
    getProduct: getProductMock,
    fetchPurchases: fetchPurchasesMock,
    addAlias: addAliasMock,
  }),
}));

const listCategoriesMock = vi.fn();
vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({ listCategories: listCategoriesMock }),
}));

const addToastMock = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

vi.mock('@/components/product/ProductFormDialog', () => ({
  ProductFormDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="form-stub" /> : null,
}));

// The gallery has its own spec — the stub surfaces its props and lets the
// test fire onChanged (post-mutation parent refetch).
vi.mock('@/components/product/ProductGallery', () => ({
  ProductGallery: ({
    product,
    editable,
    onChanged,
  }: {
    product: { id: string; name: string; images: { id: string }[] };
    editable: boolean;
    onChanged?: () => void;
  }) => (
    <div
      data-testid="gallery-stub"
      data-product={product.id}
      data-images={product.images.length}
      data-editable={String(editable)}
    >
      <button data-testid="gallery-changed" onClick={() => onChanged?.()}>
        changed
      </button>
    </div>
  ),
}));

function makeProduct(over: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: 'p-1',
    barcode: '7290119381043',
    name: 'Tapuchips Salt',
    brand: 'Elite',
    hasImage: true,
    imageVersion: 'v1',
    defaultCategoryId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    aliases: [],
    images: [
      { id: 'img-1', position: 1, version: 'v1' },
      { id: 'img-2', position: 2, version: 'v2' },
    ],
    ...over,
  };
}

describe('ProductDetailClient (8.9, gallery since 8.27)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProductMock.mockResolvedValue(makeProduct());
    fetchPurchasesMock.mockResolvedValue({ purchases: [], merchants: [] });
    listCategoriesMock.mockResolvedValue([]);
  });

  it('loads the product and hands its pictures to an editable gallery', async () => {
    render(<ProductDetailClient productId="p-1" />);

    await waitFor(() => expect(screen.getByText('Tapuchips Salt')).toBeInTheDocument());
    expect(screen.getByTestId('product-detail-barcode')).toHaveTextContent('7290119381043');

    const gallery = screen.getByTestId('gallery-stub');
    expect(gallery).toHaveAttribute('data-product', 'p-1');
    expect(gallery).toHaveAttribute('data-images', '2');
    expect(gallery).toHaveAttribute('data-editable', 'true');
  });

  it('refetches the product when the gallery reports a change', async () => {
    render(<ProductDetailClient productId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('gallery-stub')).toBeInTheDocument());
    expect(getProductMock).toHaveBeenCalledTimes(1);

    getProductMock.mockResolvedValue(makeProduct({ images: [] }));
    fireEvent.click(screen.getByTestId('gallery-changed'));
    await waitFor(() =>
      expect(screen.getByTestId('gallery-stub')).toHaveAttribute('data-images', '0'),
    );
    expect(getProductMock).toHaveBeenCalledTimes(2);
  });

  it('renders the not-found branch on a 404', async () => {
    getProductMock.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    fetchPurchasesMock.mockRejectedValue(new Error('nf'));
    render(<ProductDetailClient productId="p-x" />);
    await waitFor(() => expect(screen.getByTestId('product-detail-error')).toBeInTheDocument());
    expect(screen.getByTestId('product-detail-error').textContent).toContain('notFound');
  });

  it('adds an alias and toasts', async () => {
    addAliasMock.mockResolvedValue(makeProduct({ aliases: [] }));
    render(<ProductDetailClient productId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('product-detail-alias-input')).toBeEnabled());

    fireEvent.change(screen.getByTestId('product-detail-alias-input'), {
      target: { value: 'Chips' },
    });
    fireEvent.click(screen.getByTestId('product-detail-alias-add'));
    await waitFor(() =>
      expect(addAliasMock).toHaveBeenCalledWith(
        'p-1',
        { name: 'Chips', locale: 'en' },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('success', 'aliasAddedToast'));
  });
});
