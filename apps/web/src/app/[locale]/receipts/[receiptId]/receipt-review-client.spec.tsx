import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptReviewClient } from './receipt-review-client';
import type { RealtimeEvent } from '@/lib/realtime/realtime-types';
import type { ReceiptSummary } from '@/lib/receipt/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

const getReceiptMock = vi.fn();
const updateReceiptMock = vi.fn();
const replaceItemsMock = vi.fn();
const searchMerchantsMock = vi.fn();
const fetchFileBlobMock = vi.fn();
const retryReceiptMock = vi.fn();
const confirmReceiptMock = vi.fn();
const addToastMock = vi.fn();
const listCategoriesMock = vi.fn();
const pushMock = vi.fn();

vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({
    getReceipt: getReceiptMock,
    updateReceipt: updateReceiptMock,
    replaceItems: replaceItemsMock,
    searchMerchants: searchMerchantsMock,
    fetchFileBlob: fetchFileBlobMock,
    retryReceipt: retryReceiptMock,
    confirmReceipt: confirmReceiptMock,
  }),
}));

vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({ listCategories: listCategoriesMock }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

// The walkthrough dialog has its own spec — the stub surfaces which item it
// was opened on (row-click match editing, 8.23).
vi.mock('@/components/product/ItemWalkthroughDialog', () => ({
  ItemWalkthroughDialog: ({ open, initialItemId }: { open: boolean; initialItemId?: string }) =>
    open ? <div data-testid="walkthrough-stub" data-initial-item={initialItemId ?? ''} /> : null,
}));

vi.mock('@/lib/product/product-context', () => ({
  useProducts: () => ({
    imageUrl: (p: { id: string; imageVersion: string | null }) =>
      `/api/v1/products/${p.id}/image${p.imageVersion ? `?v=${p.imageVersion}` : ''}`,
  }),
}));

// Confirm dialog is exercised in its own spec — here we stub it to a marker
// that surfaces its props and lets us fire onConfirmed.
vi.mock('@/components/receipt/ReceiptConfirmDialog', () => ({
  ReceiptConfirmDialog: ({
    open,
    receiptId,
    defaultCategoryId,
    onConfirmed,
  }: {
    open: boolean;
    receiptId: string;
    defaultCategoryId?: string | null;
    onConfirmed: (transactionId: string) => void;
  }) =>
    open ? (
      <div
        data-testid="confirm-dialog"
        data-receipt={receiptId}
        data-default-cat={defaultCategoryId ?? ''}
      >
        <button data-testid="confirm-dialog-done" onClick={() => onConfirmed('p-9')}>
          done
        </button>
      </div>
    ) : null,
}));

// Reconcile dialog (8.15) has its own spec — stub it to a marker that lets
// tests fire onReconciled.
vi.mock('@/components/receipt/ReconcileReceiptDialog', () => ({
  ReconcileReceiptDialog: ({
    open,
    onReconciled,
  }: {
    open: boolean;
    onReconciled: (transactionId: string) => void;
  }) =>
    open ? (
      <div data-testid="reconcile-dialog">
        <button data-testid="reconcile-dialog-done" onClick={() => onReconciled('pay-1')}>
          done
        </button>
      </div>
    ) : null,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => '/',
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

// Capture realtime handlers so tests can emit events.
type Handler = (event: RealtimeEvent) => void;
const realtimeHandlers: { filter: { type: string }; handler: Handler }[] = [];
vi.mock('@/lib/realtime/use-realtime-events', () => ({
  useRealtimeEvents: (filter: { type: string }, handler: Handler) => {
    realtimeHandlers.push({ filter, handler });
  },
}));
const resyncCallbacks: (() => void)[] = [];
vi.mock('@/lib/realtime/use-realtime-resync', () => ({
  useRealtimeResync: (cb: () => void) => {
    resyncCallbacks.push(cb);
  },
}));

const emit = (event: RealtimeEvent) =>
  act(() => {
    // Only the latest registration carries fresh closures.
    const latest = realtimeHandlers.filter((h) => h.filter.type === event.type);
    latest[latest.length - 1]?.handler(event);
  });

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeReceipt(over: Partial<ReceiptSummary> = {}): ReceiptSummary {
  return {
    id: 'r-1',
    status: 'REVIEW',
    source: 'upload',
    originalName: 'receipt.jpg',
    sourceUrl: null,
    merchantId: null,
    merchantName: null,
    extractedMerchantName: 'Shufersal',
    purchasedAt: null,
    currency: 'ILS',
    totalCents: 4590,
    discountCents: null,
    failureReason: null,
    transactionId: null,
    itemsSumCents: 4590,
    totalsMismatchCents: null,
    createdAt: '2026-07-04T10:00:00.000Z',
    updatedAt: '2026-07-04T10:00:00.000Z',
    files: [{ id: 'f-1', position: 1, mimeType: 'image/jpeg' }],
    items: [
      {
        id: 'i-1',
        position: 1,
        rawName: 'Milk',
        barcode: null,
        quantity: 2,
        unitPriceCents: 1000,
        discountCents: 0,
        totalCents: 2000,
        categoryId: null,
        productId: null,
        productName: null,
        productBrand: null,
        productHasImage: false,
        productImageVersion: null,
        matchStatus: 'PENDING' as const,
        matchCandidates: [],
      },
      {
        id: 'i-2',
        position: 2,
        rawName: 'Bread',
        barcode: null,
        quantity: 1,
        unitPriceCents: null,
        discountCents: 0,
        totalCents: 2590,
        categoryId: 'cat-1',
        productId: null,
        productName: null,
        productBrand: null,
        productHasImage: false,
        productImageVersion: null,
        matchStatus: 'PENDING' as const,
        matchCandidates: [],
      },
    ],
    ...over,
  };
}

const renderLoaded = async (receipt: ReceiptSummary) => {
  getReceiptMock.mockResolvedValue(receipt);
  render(<ReceiptReviewClient receiptId={receipt.id} />);
  await waitFor(() => expect(screen.queryByTestId('receipt-review-loading')).toBeNull());
};

describe('ReceiptReviewClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtimeHandlers.length = 0;
    resyncCallbacks.length = 0;
    listCategoriesMock.mockResolvedValue([{ id: 'cat-1', name: 'Groceries' }]);
    searchMerchantsMock.mockResolvedValue([]);
    fetchFileBlobMock.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    // jsdom has no object-URL support.
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  it('hydrates a REVIEW receipt into an editable form with items and categories', async () => {
    await renderLoaded(makeReceipt());

    expect(screen.getByTestId('review-merchant')).toHaveValue('Shufersal');
    expect(screen.getByTestId('review-currency')).toHaveValue('ILS');
    expect(screen.getByTestId('review-total')).toHaveValue(45.9);
    expect(screen.getByTestId('item-name-0')).toHaveValue('Milk');
    expect(screen.getByTestId('item-qty-1')).toHaveValue(1);
    // 8.24 — unit price and discount are rendered on the card.
    expect(screen.getByTestId('item-unit-0')).toHaveValue(10);
    expect(screen.getByTestId('item-unit-1')).toHaveValue(null);
    expect(screen.getByTestId('item-discount-0')).toHaveValue(null);
    await waitFor(() => expect(screen.getByTestId('item-category-1')).toHaveValue('cat-1'));
    // No mismatch: 2000 + 2590 = 4590 = total.
    expect(screen.queryByTestId('review-mismatch-warning')).toBeNull();
    // Save stays disabled until something changes.
    expect(screen.getByTestId('review-save')).toBeDisabled();
  });

  it('renders the not-found branch on a 404 load failure', async () => {
    getReceiptMock.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    render(<ReceiptReviewClient receiptId="r-missing" />);

    await waitFor(() => expect(screen.getByTestId('receipt-review-error')).toBeInTheDocument());
    expect(screen.getByTestId('receipt-review-error').textContent).toContain('notFound');
    expect(screen.getByTestId('receipt-review-back')).toBeInTheDocument();
  });

  it('shows the generic failure copy for non-404 load errors', async () => {
    getReceiptMock.mockRejectedValue(Object.assign(new Error('Boom'), { status: 500 }));
    render(<ReceiptReviewClient receiptId="r-1" />);

    await waitFor(() => expect(screen.getByTestId('receipt-review-error')).toBeInTheDocument());
    expect(screen.getByTestId('receipt-review-error').textContent).toContain('loadFailed');
  });

  it('save PATCHes the header and PUTs the items, then toasts', async () => {
    await renderLoaded(makeReceipt());
    updateReceiptMock.mockResolvedValue(makeReceipt());
    replaceItemsMock.mockResolvedValue(makeReceipt({ totalCents: 5000 }));

    fireEvent.change(screen.getByTestId('review-total'), { target: { value: '50.00' } });
    expect(screen.getByTestId('review-save')).toBeEnabled();
    fireEvent.click(screen.getByTestId('review-save'));

    await waitFor(() =>
      expect(updateReceiptMock).toHaveBeenCalledWith(
        'r-1',
        {
          extractedMerchantName: 'Shufersal',
          merchantId: null,
          purchasedAt: null,
          currency: 'ILS',
          totalCents: 5000,
          discountCents: null,
        },
        expect.anything(),
      ),
    );
    expect(replaceItemsMock).toHaveBeenCalledWith(
      'r-1',
      [
        {
          rawName: 'Milk',
          quantity: 2,
          unitPriceCents: 1000,
          discountCents: 0,
          totalCents: 2000,
          categoryId: null,
        },
        {
          rawName: 'Bread',
          quantity: 1,
          unitPriceCents: null,
          discountCents: 0,
          totalCents: 2590,
          categoryId: 'cat-1',
        },
      ],
      expect.anything(),
    );
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('success', 'savedToast'));
    // Rehydrated from the PUT response — clean again.
    await waitFor(() => expect(screen.getByTestId('review-save')).toBeDisabled());
  });

  it('blocks saving when an item row is invalid', async () => {
    await renderLoaded(makeReceipt());

    fireEvent.change(screen.getByTestId('item-name-0'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('review-save'));

    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('error', 'itemsInvalid'));
    expect(updateReceiptMock).not.toHaveBeenCalled();
    expect(replaceItemsMock).not.toHaveBeenCalled();
  });

  it('merchant autocomplete debounces, pins the picked registry id, and sends it on save', async () => {
    await renderLoaded(makeReceipt());
    searchMerchantsMock.mockResolvedValue([{ id: 'm-1', name: 'Shufersal Deal' }]);

    fireEvent.change(screen.getByTestId('review-merchant'), { target: { value: 'Shu' } });
    // Debounced 300ms behind the keystroke.
    expect(searchMerchantsMock).not.toHaveBeenCalled();
    await waitFor(() => expect(searchMerchantsMock).toHaveBeenCalledWith('Shu'));

    await waitFor(() => expect(screen.getByTestId('merchant-suggestion-m-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('merchant-suggestion-m-1'));

    expect(screen.getByTestId('review-merchant')).toHaveValue('Shufersal Deal');
    expect(screen.getByTestId('merchant-linked')).toBeInTheDocument();
    expect(screen.queryByTestId('merchant-suggestions')).toBeNull();

    updateReceiptMock.mockResolvedValue(makeReceipt());
    replaceItemsMock.mockResolvedValue(makeReceipt());
    fireEvent.click(screen.getByTestId('review-save'));
    await waitFor(() =>
      expect(updateReceiptMock).toHaveBeenCalledWith(
        'r-1',
        expect.objectContaining({ merchantId: 'm-1', extractedMerchantName: 'Shufersal Deal' }),
        expect.anything(),
      ),
    );
  });

  it('typing after a pick unpins the merchant id', async () => {
    await renderLoaded(makeReceipt());
    searchMerchantsMock.mockResolvedValue([{ id: 'm-1', name: 'Shufersal Deal' }]);

    fireEvent.change(screen.getByTestId('review-merchant'), { target: { value: 'Shu' } });
    await waitFor(() => expect(screen.getByTestId('merchant-suggestion-m-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('merchant-suggestion-m-1'));
    expect(screen.getByTestId('merchant-linked')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('review-merchant'), { target: { value: 'Shufersal Dea' } });
    expect(screen.queryByTestId('merchant-linked')).toBeNull();
  });

  it('warns on a totals mismatch with the absolute delta', async () => {
    await renderLoaded(makeReceipt({ totalCents: 5000 }));

    // 5000 − (2000 + 2590) = 410 → 4.10.
    expect(screen.getByTestId('review-mismatch-warning').textContent).toContain(
      'mismatchWarning:4.10',
    );
  });

  it('renders read-only for non-REVIEW receipts', async () => {
    await renderLoaded(makeReceipt({ status: 'CONFIRMED' }));

    expect(screen.getByTestId('review-merchant')).toBeDisabled();
    expect(screen.getByTestId('item-name-0')).toBeDisabled();
    expect(screen.queryByTestId('review-save')).toBeNull();
    expect(screen.queryByTestId('review-add-item')).toBeNull();
    expect(screen.queryByTestId('item-remove-0')).toBeNull();
  });

  it('FAILED receipts show the failure banner and retry re-runs extraction', async () => {
    await renderLoaded(makeReceipt({ status: 'FAILED', failureReason: 'unreadable' }));
    retryReceiptMock.mockResolvedValue(makeReceipt({ status: 'UPLOADED' }));

    expect(screen.getByTestId('receipt-review-failed').textContent).toContain('unreadable');
    fireEvent.click(screen.getByTestId('receipt-review-retry'));

    await waitFor(() => expect(retryReceiptMock).toHaveBeenCalledWith('r-1', expect.anything()));
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('success', 'retriedToast'));
    await waitFor(() => expect(screen.queryByTestId('receipt-review-failed')).toBeNull());
  });

  it('adding and removing item cards works', async () => {
    await renderLoaded(makeReceipt());

    fireEvent.click(screen.getByTestId('review-add-item'));
    expect(screen.getByTestId('item-name-2')).toHaveValue('');

    fireEvent.click(screen.getByTestId('item-remove-0'));
    expect(screen.getByTestId('item-name-0')).toHaveValue('Bread');
    expect(screen.queryByTestId('receipt-item-card-2')).toBeNull();
  });

  it('edited unit price and discount round-trip on save (8.24)', async () => {
    await renderLoaded(makeReceipt());
    updateReceiptMock.mockResolvedValue(makeReceipt());
    replaceItemsMock.mockResolvedValue(makeReceipt());

    fireEvent.change(screen.getByTestId('item-unit-1'), { target: { value: '25.90' } });
    fireEvent.change(screen.getByTestId('item-discount-0'), { target: { value: '1.00' } });
    fireEvent.click(screen.getByTestId('review-save'));

    await waitFor(() =>
      expect(replaceItemsMock).toHaveBeenCalledWith(
        'r-1',
        [
          expect.objectContaining({ rawName: 'Milk', discountCents: 100 }),
          expect.objectContaining({ rawName: 'Bread', unitPriceCents: 2590 }),
        ],
        expect.anything(),
      ),
    );
  });

  // ── 8.23: registry identity on the rows ───────────────────────────────────

  it('a matched item card shows the official product name with its thumbnail', async () => {
    const receipt = makeReceipt();
    receipt.items[0] = {
      ...receipt.items[0],
      productId: 'p-1',
      productName: 'Milk 3% 1L',
      productHasImage: true,
      productImageVersion: 'v42',
      matchStatus: 'CONFIRMED',
    };
    await renderLoaded(receipt);

    expect(screen.getByTestId('item-product-0')).toHaveTextContent('Milk 3% 1L');
    // 8.24 — the thumbnail lives in the card header, beside the name.
    const card = screen.getByTestId('receipt-item-card-0');
    expect(card.querySelector('img')?.getAttribute('src')).toBe('/api/v1/products/p-1/image?v=v42');
  });

  it('an unmatched row chip shows the printed code and opens the match dialog on that item', async () => {
    const receipt = makeReceipt();
    receipt.items[1] = { ...receipt.items[1], barcode: '7290119381043' };
    await renderLoaded(receipt);

    const chip = screen.getByTestId('item-product-1');
    expect(chip).toHaveTextContent('itemMatchAction');
    expect(chip).toHaveTextContent('7290119381043');
    fireEvent.click(chip);
    expect(screen.getByTestId('walkthrough-stub')).toHaveAttribute('data-initial-item', 'i-2');
  });

  it('the header walkthrough button opens the dialog without an initial item', async () => {
    await renderLoaded(makeReceipt());
    fireEvent.click(screen.getByTestId('review-walkthrough'));
    expect(screen.getByTestId('walkthrough-stub')).toHaveAttribute('data-initial-item', '');
  });

  it('shows the authenticated blob preview for uploaded images', async () => {
    await renderLoaded(makeReceipt());

    await waitFor(() =>
      expect(screen.getByTestId('receipt-preview-image')).toHaveAttribute('src', 'blob:preview'),
    );
    expect(fetchFileBlobMock).toHaveBeenCalledWith('r-1', 'f-1');
  });

  it('URL-sourced receipts link out instead of fetching the blob', async () => {
    await renderLoaded(makeReceipt({ source: 'url', sourceUrl: 'https://r.example/x', files: [] }));

    expect(screen.getByTestId('receipt-preview-url')).toHaveAttribute(
      'href',
      'https://r.example/x',
    );
    expect(fetchFileBlobMock).not.toHaveBeenCalled();
  });

  it('realtime receipt.updated rehydrates the form when not mid-edit', async () => {
    await renderLoaded(makeReceipt());

    emit({
      type: 'receipt.updated',
      receipt: makeReceipt({ extractedMerchantName: 'Rami Levy', totalCents: 9900 }),
    });

    await waitFor(() => expect(screen.getByTestId('review-merchant')).toHaveValue('Rami Levy'));
    expect(screen.getByTestId('review-total')).toHaveValue(99);
  });

  it('realtime resync refetches unless the form is dirty', async () => {
    await renderLoaded(makeReceipt());
    expect(getReceiptMock).toHaveBeenCalledTimes(1);

    // Second load resolves distinguishable data so we can await full rehydration.
    getReceiptMock.mockResolvedValue(makeReceipt({ extractedMerchantName: 'Fresh' }));
    act(() => resyncCallbacks[resyncCallbacks.length - 1]!());
    await waitFor(() => expect(screen.getByTestId('review-merchant')).toHaveValue('Fresh'));
    expect(getReceiptMock).toHaveBeenCalledTimes(2);

    fireEvent.change(screen.getByTestId('review-total'), { target: { value: '99.00' } });
    act(() => resyncCallbacks[resyncCallbacks.length - 1]!());
    expect(getReceiptMock).toHaveBeenCalledTimes(2);
  });

  it('opens the confirm dialog with the receipt id and most-common item category', async () => {
    await renderLoaded(makeReceipt());
    expect(screen.getByTestId('review-confirm')).toBeEnabled();

    fireEvent.click(screen.getByTestId('review-confirm'));
    const dialog = screen.getByTestId('confirm-dialog');
    expect(dialog).toHaveAttribute('data-receipt', 'r-1');
    // Item i-2 carries cat-1; i-1 has none → cat-1 is the default.
    expect(dialog).toHaveAttribute('data-default-cat', 'cat-1');
  });

  it('disables Confirm while there are unsaved edits', async () => {
    await renderLoaded(makeReceipt());
    fireEvent.change(screen.getByTestId('review-total'), { target: { value: '50.00' } });
    expect(screen.getByTestId('review-confirm')).toBeDisabled();
    expect(screen.getByTestId('review-confirm-hint')).toBeInTheDocument();
  });

  it('navigates to the new transaction once confirmation completes', async () => {
    await renderLoaded(makeReceipt());
    fireEvent.click(screen.getByTestId('review-confirm'));
    fireEvent.click(screen.getByTestId('confirm-dialog-done'));

    expect(pushMock).toHaveBeenCalledWith('/transactions/p-9');
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull());
  });

  it('non-REVIEW receipts do not offer Confirm', async () => {
    await renderLoaded(makeReceipt({ status: 'CONFIRMED' }));
    expect(screen.queryByTestId('review-confirm')).toBeNull();
  });

  // ── Attached receipts reconcile instead of confirm (8.15) ──────────────────

  it('an attached receipt offers Reconcile (not Confirm) and auto-opens the dialog', async () => {
    await renderLoaded(makeReceipt({ transactionId: 'pay-1' }));
    // Confirm is replaced by Reconcile.
    expect(screen.queryByTestId('review-confirm')).toBeNull();
    expect(screen.getByTestId('review-reconcile')).toBeInTheDocument();
    // Reaching REVIEW while attached auto-opens the reconcile dialog.
    await waitFor(() => expect(screen.getByTestId('reconcile-dialog')).toBeInTheDocument());
  });

  it('completing reconciliation routes to the linked transaction', async () => {
    await renderLoaded(makeReceipt({ transactionId: 'pay-1' }));
    // The reconcile dialog auto-opens via an effect — wait for it rather than
    // racing the click against the flush.
    fireEvent.click(await screen.findByTestId('reconcile-dialog-done'));
    expect(pushMock).toHaveBeenCalledWith('/transactions/pay-1');
    await waitFor(() => expect(screen.queryByTestId('reconcile-dialog')).toBeNull());
  });
});
