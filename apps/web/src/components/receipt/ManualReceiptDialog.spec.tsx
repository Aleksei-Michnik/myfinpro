import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualReceiptDialog } from './ManualReceiptDialog';
import type { ReceiptSummary } from '@/lib/receipt/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  useLocale: () => 'en',
}));

const createManualMock = vi.fn();
vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({ createManual: createManualMock }),
}));

const lookupBarcodeMock = vi.fn();
const fetchPurchasesMock = vi.fn();
vi.mock('@/lib/product/product-context', () => ({
  useProducts: () => ({ lookupBarcode: lookupBarcodeMock, fetchPurchases: fetchPurchasesMock }),
}));

const addToastMock = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

// The camera scanner and product-create form have their own specs; here we
// only need to drive their callbacks. A valid EAN-13 is fed to onDetected so
// the real GTIN validation in the dialog passes.
const holder = vi.hoisted(() => ({
  scanCode: '4006381333931',
  newProduct: { id: 'p-new', name: 'Fresh Bread', brand: 'Local Bakery' },
}));
vi.mock('../product/BarcodeScannerDialog', () => ({
  BarcodeScannerDialog: ({
    open,
    onDetected,
  }: {
    open: boolean;
    onDetected: (c: string) => void;
  }) =>
    open ? (
      <button data-testid="scanner-detect" onClick={() => onDetected(holder.scanCode)}>
        detect
      </button>
    ) : null,
}));
vi.mock('../product/ProductFormDialog', () => ({
  ProductFormDialog: ({ open, onSaved }: { open: boolean; onSaved: (p: unknown) => void }) =>
    open ? (
      <button data-testid="form-save" onClick={() => onSaved(holder.newProduct)}>
        save
      </button>
    ) : null,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

function renderDialog() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <ManualReceiptDialog
      open
      defaultCurrency="ILS"
      categories={[]}
      onClose={onClose}
      onCreated={onCreated}
    />,
  );
  return { onClose, onCreated };
}

describe('ManualReceiptDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookupBarcodeMock.mockResolvedValue({ found: false, offStatus: 'miss' });
    fetchPurchasesMock.mockResolvedValue({ purchases: [], merchants: [] });
  });

  it('shows the empty state and a zero total before any product is added', () => {
    renderDialog();
    expect(screen.getByTestId('manual-receipt-empty')).toBeTruthy();
    expect(screen.getByTestId('manual-receipt-total').textContent).toContain('0.00');
    expect(screen.getByTestId('manual-receipt-submit')).toBeDisabled();
  });

  it('scanning a known barcode adds a line and prefills its price from history', async () => {
    lookupBarcodeMock.mockResolvedValue({
      found: true,
      product: { id: 'p-1', name: 'Milk 3%', brand: 'Tnuva' },
      offStatus: 'registry',
    });
    fetchPurchasesMock.mockResolvedValue({
      purchases: [],
      merchants: [
        { merchantName: 'Old', lastPurchasedAt: '2026-05-01', lastUnitPriceCents: 500 },
        { merchantName: 'New', lastPurchasedAt: '2026-06-20', lastUnitPriceCents: 550 },
      ],
    });
    renderDialog();

    fireEvent.click(screen.getByTestId('manual-receipt-scan'));
    fireEvent.click(screen.getByTestId('scanner-detect'));

    await waitFor(() => expect(screen.getByTestId('manual-receipt-line-p-1')).toBeTruthy());
    // Most-recent merchant wins the price memory.
    await waitFor(() =>
      expect((screen.getByTestId('manual-receipt-price-p-1') as HTMLInputElement).value).toBe(
        '5.50',
      ),
    );
    expect((screen.getByTestId('manual-receipt-qty-p-1') as HTMLInputElement).value).toBe('1');
  });

  it('re-scanning the same product increments its quantity instead of duplicating', async () => {
    lookupBarcodeMock.mockResolvedValue({
      found: true,
      product: { id: 'p-1', name: 'Milk 3%', brand: 'Tnuva' },
      offStatus: 'registry',
    });
    renderDialog();

    fireEvent.click(screen.getByTestId('manual-receipt-scan'));
    fireEvent.click(screen.getByTestId('scanner-detect'));
    await waitFor(() => expect(screen.getByTestId('manual-receipt-line-p-1')).toBeTruthy());

    fireEvent.click(screen.getByTestId('manual-receipt-scan'));
    fireEvent.click(screen.getByTestId('scanner-detect'));
    await waitFor(() =>
      expect((screen.getByTestId('manual-receipt-qty-p-1') as HTMLInputElement).value).toBe('2'),
    );
    expect(screen.getAllByTestId(/manual-receipt-line-/)).toHaveLength(1);
  });

  it('an unknown barcode opens the create form and adds the created product', async () => {
    lookupBarcodeMock.mockResolvedValue({ found: false, offStatus: 'miss' });
    renderDialog();

    fireEvent.click(screen.getByTestId('manual-receipt-scan'));
    fireEvent.click(screen.getByTestId('scanner-detect'));
    await waitFor(() => expect(screen.getByTestId('form-save')).toBeTruthy());

    fireEvent.click(screen.getByTestId('form-save'));
    await waitFor(() => expect(screen.getByTestId('manual-receipt-line-p-new')).toBeTruthy());
  });

  it('submits the composed items and hands the created receipt back to the parent', async () => {
    lookupBarcodeMock.mockResolvedValue({
      found: true,
      product: { id: 'p-1', name: 'Milk 3%', brand: 'Tnuva' },
      offStatus: 'registry',
    });
    fetchPurchasesMock.mockResolvedValue({ purchases: [], merchants: [] });
    const created = { id: 'r-42' } as ReceiptSummary;
    createManualMock.mockResolvedValue(created);
    const { onCreated } = renderDialog();

    fireEvent.click(screen.getByTestId('manual-receipt-scan'));
    fireEvent.click(screen.getByTestId('scanner-detect'));
    await waitFor(() => expect(screen.getByTestId('manual-receipt-line-p-1')).toBeTruthy());

    fireEvent.change(screen.getByTestId('manual-receipt-qty-p-1'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('manual-receipt-price-p-1'), { target: { value: '7.50' } });
    fireEvent.click(screen.getByTestId('manual-receipt-submit'));

    await waitFor(() => expect(createManualMock).toHaveBeenCalled());
    const [input] = createManualMock.mock.calls[0];
    expect(input).toEqual(
      expect.objectContaining({
        currency: 'ILS',
        items: [{ productId: 'p-1', quantity: 2, unitPriceCents: 750 }],
      }),
    );
    expect(typeof input.purchasedAt).toBe('string');
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
  });

  it('keeps submit disabled until every line has a valid price', async () => {
    lookupBarcodeMock.mockResolvedValue({
      found: true,
      product: { id: 'p-1', name: 'Milk 3%', brand: 'Tnuva' },
      offStatus: 'registry',
    });
    fetchPurchasesMock.mockResolvedValue({ purchases: [], merchants: [] });
    renderDialog();

    fireEvent.click(screen.getByTestId('manual-receipt-scan'));
    fireEvent.click(screen.getByTestId('scanner-detect'));
    await waitFor(() => expect(screen.getByTestId('manual-receipt-line-p-1')).toBeTruthy());

    // No price yet → invalid line → disabled.
    expect(screen.getByTestId('manual-receipt-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('manual-receipt-price-p-1'), { target: { value: '3.00' } });
    expect(screen.getByTestId('manual-receipt-submit')).not.toBeDisabled();
  });

  it('removes a line', async () => {
    lookupBarcodeMock.mockResolvedValue({
      found: true,
      product: { id: 'p-1', name: 'Milk 3%', brand: 'Tnuva' },
      offStatus: 'registry',
    });
    renderDialog();

    fireEvent.click(screen.getByTestId('manual-receipt-scan'));
    fireEvent.click(screen.getByTestId('scanner-detect'));
    await waitFor(() => expect(screen.getByTestId('manual-receipt-line-p-1')).toBeTruthy());

    fireEvent.click(screen.getByTestId('manual-receipt-remove-p-1'));
    expect(screen.queryByTestId('manual-receipt-line-p-1')).toBeNull();
    expect(screen.getByTestId('manual-receipt-empty')).toBeTruthy();
  });
});
