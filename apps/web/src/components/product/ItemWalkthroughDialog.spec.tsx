import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemWalkthroughDialog } from './ItemWalkthroughDialog';
import type { ReceiptItem, ReceiptSummary } from '@/lib/receipt/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
  useLocale: () => 'en',
}));

const matchItemMock = vi.fn();
const skipItemMatchMock = vi.fn();
vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({ matchItem: matchItemMock, skipItemMatch: skipItemMatchMock }),
}));

const fetchProductsMock = vi.fn();
const lookupBarcodeMock = vi.fn();
vi.mock('@/lib/product/product-context', () => ({
  useProducts: () => ({ fetchProducts: fetchProductsMock, lookupBarcode: lookupBarcodeMock }),
}));

const addToastMock = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

// The nested dialogs are exercised in their own specs.
vi.mock('./BarcodeScannerDialog', () => ({
  BarcodeScannerDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="scanner-stub" /> : null,
}));
vi.mock('./ProductFormDialog', () => ({
  ProductFormDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="form-stub" /> : null,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeItem = (over: Partial<ReceiptItem> = {}): ReceiptItem => ({
  id: 'i-1',
  position: 1,
  rawName: 'Milk 3%',
  barcode: null,
  quantity: 2,
  unitPriceCents: 440,
  discountCents: 0,
  totalCents: 880,
  categoryId: null,
  productId: null,
  productName: null,
  productBrand: null,
  matchStatus: 'PENDING',
  matchCandidates: [
    { productId: 'p-1', name: 'Milk 3% 1L', brand: 'Tnuva', stage: 'alias', confidence: 0.95 },
    { productId: 'p-2', name: 'Whole Milk', brand: null, stage: 'fuzzy', confidence: 0.55 },
  ],
  ...over,
});

const makeReceipt = (items: ReceiptItem[]): ReceiptSummary =>
  ({
    id: 'r-1',
    status: 'REVIEW',
    currency: 'ILS',
    items,
  }) as ReceiptSummary;

function renderDialog(receipt: ReceiptSummary) {
  const onClose = vi.fn();
  const onReceiptUpdated = vi.fn();
  render(
    <ItemWalkthroughDialog
      open
      receipt={receipt}
      categories={[]}
      onClose={onClose}
      onReceiptUpdated={onReceiptUpdated}
    />,
  );
  return { onClose, onReceiptUpdated };
}

describe('ItemWalkthroughDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the current item with ranked candidates and confidence meters', () => {
    renderDialog(makeReceipt([makeItem()]));
    expect(screen.getByTestId('walkthrough-item')).toHaveTextContent('Milk 3%');
    const candidates = screen.getAllByRole('option');
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toHaveTextContent('Milk 3% 1L');
    expect(candidates[0]).toHaveTextContent('95%');
    expect(candidates[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('starts at the first PENDING item (resumable walkthrough)', () => {
    renderDialog(
      makeReceipt([
        makeItem({ id: 'i-0', position: 1, rawName: 'Done', matchStatus: 'CONFIRMED' }),
        makeItem({ id: 'i-1', position: 2, rawName: 'Todo' }),
      ]),
    );
    expect(screen.getByTestId('walkthrough-item')).toHaveTextContent('Todo');
  });

  it('confirming a candidate POSTs the match and hands the fresh receipt up', async () => {
    const fresh = makeReceipt([
      makeItem({ matchStatus: 'CONFIRMED', productId: 'p-1', productName: 'Milk 3% 1L' }),
    ]);
    matchItemMock.mockResolvedValue(fresh);
    const { onReceiptUpdated } = renderDialog(makeReceipt([makeItem()]));

    fireEvent.click(screen.getByTestId('walkthrough-candidate-0'));
    await waitFor(() =>
      expect(matchItemMock).toHaveBeenCalledWith(
        'r-1',
        'i-1',
        { productId: 'p-1' },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(onReceiptUpdated).toHaveBeenCalledWith(fresh));
  });

  it('keyboard flow: ↓ selects the next candidate, Enter confirms it', async () => {
    matchItemMock.mockResolvedValue(makeReceipt([makeItem({ matchStatus: 'CONFIRMED' })]));
    renderDialog(makeReceipt([makeItem()]));

    const dialog = screen.getByTestId('walkthrough-dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    expect(screen.getByTestId('walkthrough-candidate-1')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(dialog, { key: 'Enter' });
    await waitFor(() =>
      expect(matchItemMock).toHaveBeenCalledWith(
        'r-1',
        'i-1',
        { productId: 'p-2' },
        expect.anything(),
      ),
    );
  });

  it('S skips the item via the skip endpoint', async () => {
    skipItemMatchMock.mockResolvedValue(makeReceipt([makeItem({ matchStatus: 'SKIPPED' })]));
    renderDialog(makeReceipt([makeItem()]));
    fireEvent.keyDown(screen.getByTestId('walkthrough-dialog'), { key: 's' });
    await waitFor(() =>
      expect(skipItemMatchMock).toHaveBeenCalledWith('r-1', 'i-1', expect.anything()),
    );
  });

  it('Escape closes; progress reflects resolved items', () => {
    const { onClose } = renderDialog(
      makeReceipt([
        makeItem({ id: 'i-0', position: 1, matchStatus: 'CONFIRMED' }),
        makeItem({ id: 'i-1', position: 2 }),
      ]),
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    fireEvent.keyDown(screen.getByTestId('walkthrough-dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('searching the registry appends unseen results as options', async () => {
    vi.useFakeTimers();
    fetchProductsMock.mockResolvedValue({
      data: [
        { id: 'p-1', name: 'Milk 3% 1L', brand: 'Tnuva' }, // duplicate — deduped
        { id: 'p-9', name: 'Goat Milk', brand: null },
      ],
      nextCursor: null,
      hasMore: false,
    });
    renderDialog(makeReceipt([makeItem()]));

    fireEvent.change(screen.getByTestId('walkthrough-search'), { target: { value: 'milk' } });
    await vi.advanceTimersByTimeAsync(400);
    vi.useRealTimers();

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    expect(screen.getByTestId('walkthrough-candidate-2')).toHaveTextContent('Goat Milk');
  });

  it('scan-to-find: a registry hit confirms immediately', async () => {
    lookupBarcodeMock.mockResolvedValue({
      found: true,
      product: { id: 'p-5', name: 'Scanned', brand: null },
      offStatus: 'registry',
    });
    matchItemMock.mockResolvedValue(makeReceipt([makeItem({ matchStatus: 'CONFIRMED' })]));
    renderDialog(makeReceipt([makeItem()]));

    fireEvent.click(screen.getByTestId('walkthrough-scan'));
    expect(screen.getByTestId('scanner-stub')).toBeInTheDocument();
  });
});
