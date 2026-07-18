import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const getProductMock = vi.fn().mockResolvedValue({ images: [] });
const uploadImageMock = vi.fn();
const removeImageMock = vi.fn();
const reorderImageMock = vi.fn();
vi.mock('@/lib/product/product-context', () => ({
  useProducts: () => ({
    createProduct: createProductMock,
    updateProduct: updateProductMock,
    lookupBarcode: lookupBarcodeMock,
    getProduct: getProductMock,
    uploadImage: uploadImageMock,
    removeImage: removeImageMock,
    reorderImage: reorderImageMock,
    productImageUrl: (id: string, img: { id: string; version: string }, size?: string) =>
      `/api/v1/products/${id}/images/${img.id}?size=${size ?? 'full'}&v=${img.version}`,
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

  describe('pictures (8.25)', () => {
    const stageFile = (name: string) => {
      const file = new File(['x'], name, { type: 'image/jpeg' });
      fireEvent.change(screen.getByTestId('product-picture-file-input'), {
        target: { files: [file] },
      });
      return file;
    };

    it('create mode: stages pictures, removes them, and uploads after create', async () => {
      createProductMock.mockResolvedValue({ ...PRODUCT, id: 'p-new' });
      uploadImageMock.mockResolvedValue({ id: 'img-1', position: 1, version: 'v1' });
      const onSaved = vi.fn();
      render(
        <ProductFormDialog
          open
          initialName="Milk"
          categories={[]}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />,
      );

      const kept = stageFile('kept.jpg');
      stageFile('dropped.jpg');
      expect(screen.getByTestId('product-picture-0')).toBeInTheDocument();
      expect(screen.getByTestId('product-picture-1')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('product-picture-remove-1'));
      expect(screen.queryByTestId('product-picture-1')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('product-form-submit'));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      // The staged picture uploads only after the id exists.
      expect(uploadImageMock).toHaveBeenCalledTimes(1);
      expect(uploadImageMock).toHaveBeenCalledWith('p-new', kept, expect.anything());
    });

    it('edit mode: loads the gallery, uploads immediately, removes and re-primaries', async () => {
      getProductMock.mockResolvedValue({
        ...PRODUCT,
        images: [
          { id: 'img-1', position: 1, version: 'v1' },
          { id: 'img-2', position: 2, version: 'v2' },
        ],
      });
      uploadImageMock.mockResolvedValue({ id: 'img-3', position: 3, version: 'v3' });
      reorderImageMock.mockResolvedValue([
        { id: 'img-2', position: 1, version: 'v2' },
        { id: 'img-1', position: 2, version: 'v1' },
      ]);
      render(
        <ProductFormDialog
          open
          product={PRODUCT}
          categories={[]}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
      await waitFor(() => expect(screen.getByTestId('product-picture-1')).toBeInTheDocument());

      stageFile('third.jpg');
      await waitFor(() =>
        expect(uploadImageMock).toHaveBeenCalledWith('p-1', expect.any(File), expect.anything()),
      );
      await waitFor(() => expect(screen.getByTestId('product-picture-2')).toBeInTheDocument());

      fireEvent.click(screen.getByTestId('product-picture-primary-1'));
      await waitFor(() =>
        expect(reorderImageMock).toHaveBeenCalledWith('p-1', 'img-2', 1, expect.anything()),
      );

      removeImageMock.mockResolvedValue(undefined);
      fireEvent.click(screen.getByTestId('product-picture-remove-0'));
      await waitFor(() => expect(removeImageMock).toHaveBeenCalled());
    });

    it('rejects unsupported/oversize pictures client-side without staging them (8.27)', () => {
      render(
        <ProductFormDialog
          open
          initialName="Milk"
          categories={[]}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />,
      );

      const gif = new File(['x'], 'x.gif', { type: 'image/gif' });
      const huge = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
      Object.defineProperty(huge, 'size', { value: 11 * 1024 * 1024 });
      fireEvent.change(screen.getByTestId('product-picture-file-input'), {
        target: { files: [gif, huge] },
      });

      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('rejectedType'));
      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('rejectedSize'));
      expect(screen.queryByTestId('product-picture-0')).not.toBeInTheDocument();
      expect(uploadImageMock).not.toHaveBeenCalled();
    });

    it('hides the capture buttons at the 5-picture cap', async () => {
      getProductMock.mockResolvedValue({
        ...PRODUCT,
        images: [1, 2, 3, 4, 5].map((n) => ({ id: `img-${n}`, position: n, version: `v${n}` })),
      });
      render(
        <ProductFormDialog
          open
          product={PRODUCT}
          categories={[]}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
      await waitFor(() => expect(screen.getByTestId('product-picture-4')).toBeInTheDocument());
      expect(screen.queryByTestId('product-picture-file-input')).not.toBeInTheDocument();
    });
  });
});
