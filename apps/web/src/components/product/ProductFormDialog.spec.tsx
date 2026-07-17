import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductFormDialog } from './ProductFormDialog';
import type { ProductSummary } from '@/lib/product/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  useLocale: () => 'en',
}));

const createProductMock = vi.fn();
const updateProductMock = vi.fn();
const lookupBarcodeMock = vi.fn();
vi.mock('@/lib/product/product-context', () => ({
  useProducts: () => ({
    createProduct: createProductMock,
    updateProduct: updateProductMock,
    lookupBarcode: lookupBarcodeMock,
  }),
}));

const addToastMock = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

vi.mock('./BarcodeScannerDialog', () => ({
  BarcodeScannerDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="scanner-stub" /> : null,
}));

const PRODUCT: ProductSummary = {
  id: 'p-1',
  barcode: '7290119381043',
  name: 'Tapuchips Salt',
  brand: 'Elite',
  hasImage: false,
  imageVersion: null,
  defaultCategoryId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('ProductFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-resolves an initial barcode on open, prefilling empty fields from OFF (8.23)', async () => {
    lookupBarcodeMock.mockResolvedValue({
      found: false,
      prefill: { name: 'Tapuchips Salt', brand: 'Elite', imageUrl: 'https://img.example/x.jpg' },
      offStatus: 'off',
    });
    render(
      <ProductFormDialog
        open
        initialBarcode="7290119381043"
        categories={[]}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => expect(lookupBarcodeMock).toHaveBeenCalledWith('7290119381043'));
    await waitFor(() => expect(screen.getByTestId('product-form-off-filled')).toBeInTheDocument());
    expect(screen.getByTestId('product-form-name')).toHaveValue('Tapuchips Salt');
    expect(screen.getByTestId('product-form-brand')).toHaveValue('Elite');
  });

  it('a typed initial name survives the OFF prefill (only empty fields fill)', async () => {
    lookupBarcodeMock.mockResolvedValue({
      found: false,
      prefill: { name: 'OFF Name', brand: 'Elite', imageUrl: null },
      offStatus: 'off',
    });
    render(
      <ProductFormDialog
        open
        initialName="My spelling"
        initialBarcode="7290119381043"
        categories={[]}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('product-form-brand')).toHaveValue('Elite'));
    expect(screen.getByTestId('product-form-name')).toHaveValue('My spelling');
  });

  it('does not auto-resolve in edit mode', () => {
    render(
      <ProductFormDialog
        open
        product={PRODUCT}
        categories={[]}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(lookupBarcodeMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('product-form-name')).toHaveValue('Tapuchips Salt');
  });
});
