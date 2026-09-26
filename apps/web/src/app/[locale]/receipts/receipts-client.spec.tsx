import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptsClient } from './receipts-client';
import type { RealtimeEvent } from '@/lib/realtime/realtime-types';
import type { ReceiptSummary } from '@/lib/receipt/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values && 'count' in values ? `${key}:${values.count}` : key,
}));

const uploadReceiptMock = vi.fn();
const createFromUrlMock = vi.fn();
const fetchListMock = vi.fn();
const retryReceiptMock = vi.fn();
const removeReceiptMock = vi.fn();
const addToastMock = vi.fn();

vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({
    uploadReceipt: uploadReceiptMock,
    createFromUrl: createFromUrlMock,
    fetchList: fetchListMock,
    retryReceipt: retryReceiptMock,
    removeReceipt: removeReceiptMock,
    fileUrl: (id: string) => `/api/v1/receipts/${id}/file`,
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', defaultCurrency: 'USD' } }),
}));

// 8.29 — the page loads the OUT categories for the barcode composer.
const fetchAllMock = vi.fn();
vi.mock('@/lib/category/category-context', () => ({
  useCategories: () => ({ fetchAll: fetchAllMock }),
}));

// The barcode composer has its own spec; here we only need to see it mount.
vi.mock('@/components/receipt/ManualReceiptDialog', () => ({
  ManualReceiptDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="manual-receipt-stub" /> : null,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
    realtimeHandlers.filter((h) => h.filter.type === event.type).forEach((h) => h.handler(event));
  });

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeReceipt(over: Partial<ReceiptSummary> = {}): ReceiptSummary {
  return {
    id: 'r-1',
    status: 'UPLOADED',
    source: 'upload',
    originalName: 'receipt.jpg',
    sourceUrl: null,
    merchantId: null,
    merchantName: null,
    extractedMerchantName: null,
    purchasedAt: null,
    currency: null,
    totalCents: null,
    discountCents: null,
    extractionReasoning: null,
    failureReason: null,
    transactionId: null,
    itemsSumCents: 0,
    totalsMismatchCents: null,
    createdAt: '2026-07-04T10:00:00.000Z',
    updatedAt: '2026-07-04T10:00:00.000Z',
    items: [],
    files: [{ id: 'f-1', position: 1, mimeType: 'image/jpeg' }],
    ...over,
  };
}

const page = (data: ReceiptSummary[], nextCursor: string | null = null) => ({
  data,
  nextCursor,
  hasMore: nextCursor !== null,
});

describe('ReceiptsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtimeHandlers.length = 0;
    resyncCallbacks.length = 0;
    fetchListMock.mockResolvedValue(page([]));
    fetchAllMock.mockResolvedValue([]);
  });

  it('loads and renders the first page with status pills', async () => {
    fetchListMock.mockResolvedValue(
      page([
        makeReceipt({
          id: 'r-1',
          status: 'REVIEW',
          extractedMerchantName: 'Shufersal',
          totalCents: 4590,
          currency: 'ILS',
        }),
        makeReceipt({ id: 'r-2', status: 'FAILED', failureReason: 'unreadable' }),
      ]),
    );
    render(<ReceiptsClient />);
    await waitFor(() => expect(screen.getByTestId('receipt-row-r-1')).toBeInTheDocument());
    expect(screen.getByTestId('receipt-row-r-1').textContent).toContain('Shufersal');
    expect(
      screen.getByTestId('receipt-row-r-1').querySelector('[data-status="REVIEW"]'),
    ).toBeTruthy();
    expect(screen.getByTestId('receipt-failure-r-2').textContent).toBe('unreadable');
    // Retry offered only on the FAILED row.
    expect(screen.getByTestId('receipt-retry-r-2')).toBeInTheDocument();
    expect(screen.queryByTestId('receipt-retry-r-1')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no receipts', async () => {
    render(<ReceiptsClient />);
    await waitFor(() => expect(screen.getByTestId('receipts-empty')).toBeInTheDocument());
  });

  it('prepends what the intake created and confirms with one toast (8.29)', async () => {
    render(<ReceiptsClient />);
    await waitFor(() => expect(fetchListMock).toHaveBeenCalled());
    uploadReceiptMock.mockResolvedValue(makeReceipt({ id: 'r-new' }));

    const file = new File(['x'], 'r.jpg', { type: 'image/jpeg' });
    fireEvent.drop(screen.getByTestId('receipt-intake'), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByTestId('receipt-row-r-new')).toBeInTheDocument());
    expect(uploadReceiptMock).toHaveBeenCalledWith([file], expect.anything());
    expect(addToastMock).toHaveBeenCalledWith('success', 'upload.addedToast:1');
  });

  it('counts several created receipts in one toast and dedupes against the list', async () => {
    global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = vi.fn();
    fetchListMock.mockResolvedValue(page([makeReceipt({ id: 'r-a' })]));
    render(<ReceiptsClient />);
    await waitFor(() => expect(screen.getByTestId('receipt-row-r-a')).toBeInTheDocument());
    uploadReceiptMock
      .mockResolvedValueOnce(makeReceipt({ id: 'r-a' }))
      .mockResolvedValueOnce(makeReceipt({ id: 'r-b' }));

    fireEvent.drop(screen.getByTestId('receipt-intake'), {
      dataTransfer: {
        files: [
          new File(['1'], 'p1.jpg', { type: 'image/jpeg' }),
          new File(['2'], 'p2.jpg', { type: 'image/jpeg' }),
        ],
      },
    });
    fireEvent.click(screen.getByTestId('receipt-staged-upload-separately'));

    await waitFor(() => expect(screen.getByTestId('receipt-row-r-b')).toBeInTheDocument());
    expect(addToastMock).toHaveBeenCalledWith('success', 'upload.addedToast:2');
    expect(screen.getAllByTestId(/^receipt-row-/)).toHaveLength(2);
  });

  it('offers the barcode composer with the OUT categories (8.29)', async () => {
    fetchAllMock.mockResolvedValue([
      { id: 'c-out', direction: 'OUT' },
      { id: 'c-in', direction: 'IN' },
    ]);
    render(<ReceiptsClient />);
    await waitFor(() => expect(fetchListMock).toHaveBeenCalled());

    expect(screen.queryByTestId('manual-receipt-stub')).toBeNull();
    fireEvent.click(screen.getByTestId('receipt-barcodes'));

    expect(screen.getByTestId('manual-receipt-stub')).toBeInTheDocument();
    await waitFor(() => expect(fetchAllMock).toHaveBeenCalled());
  });

  it('retries FAILED receipts and patches the row', async () => {
    fetchListMock.mockResolvedValue(page([makeReceipt({ status: 'FAILED' })]));
    retryReceiptMock.mockResolvedValue(makeReceipt({ status: 'UPLOADED' }));
    render(<ReceiptsClient />);
    await waitFor(() => expect(screen.getByTestId('receipt-retry-r-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('receipt-retry-r-1'));
    await waitFor(() => expect(retryReceiptMock).toHaveBeenCalledWith('r-1', expect.anything()));
    await waitFor(() =>
      expect(
        screen.getByTestId('receipt-row-r-1').querySelector('[data-status="UPLOADED"]'),
      ).toBeTruthy(),
    );
  });

  it('delete is two-step and removes the row', async () => {
    fetchListMock.mockResolvedValue(page([makeReceipt({ status: 'REVIEW' })]));
    removeReceiptMock.mockResolvedValue(undefined);
    render(<ReceiptsClient />);
    await waitFor(() => expect(screen.getByTestId('receipt-delete-r-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('receipt-delete-r-1'));
    expect(removeReceiptMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('receipt-delete-confirm-r-1'));
    await waitFor(() => expect(removeReceiptMock).toHaveBeenCalledWith('r-1', expect.anything()));
    await waitFor(() => expect(screen.queryByTestId('receipt-row-r-1')).not.toBeInTheDocument());
  });

  it('confirmed receipts cannot be deleted from the list', async () => {
    fetchListMock.mockResolvedValue(page([makeReceipt({ status: 'CONFIRMED' })]));
    render(<ReceiptsClient />);
    await waitFor(() => expect(screen.getByTestId('receipt-row-r-1')).toBeInTheDocument());
    expect(screen.queryByTestId('receipt-delete-r-1')).not.toBeInTheDocument();
  });

  it('receipt.updated patches known rows and prepends unknown ones; receipt.deleted removes', async () => {
    fetchListMock.mockResolvedValue(page([makeReceipt({ status: 'EXTRACTING' })]));
    render(<ReceiptsClient />);
    await waitFor(() => expect(screen.getByTestId('receipt-row-r-1')).toBeInTheDocument());

    emit({
      type: 'receipt.updated',
      receipt: makeReceipt({ status: 'REVIEW', extractedMerchantName: 'Store X' }),
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('receipt-row-r-1').querySelector('[data-status="REVIEW"]'),
      ).toBeTruthy(),
    );

    emit({ type: 'receipt.updated', receipt: makeReceipt({ id: 'r-other' }) });
    await waitFor(() => expect(screen.getByTestId('receipt-row-r-other')).toBeInTheDocument());

    emit({ type: 'receipt.deleted', receiptId: 'r-1' });
    await waitFor(() => expect(screen.queryByTestId('receipt-row-r-1')).not.toBeInTheDocument());
  });

  it('refetches the first page on realtime resync', async () => {
    render(<ReceiptsClient />);
    await waitFor(() => expect(fetchListMock).toHaveBeenCalledTimes(1));
    act(() => resyncCallbacks[resyncCallbacks.length - 1]!());
    await waitFor(() => expect(fetchListMock).toHaveBeenCalledTimes(2));
  });

  it('paginates with the cursor and dedupes', async () => {
    fetchListMock.mockResolvedValueOnce(page([makeReceipt({ id: 'r-1' })], 'CURSOR'));
    render(<ReceiptsClient />);
    await waitFor(() => expect(screen.getByTestId('receipts-load-more')).toBeInTheDocument());

    fetchListMock.mockResolvedValueOnce(
      page([makeReceipt({ id: 'r-1' }), makeReceipt({ id: 'r-2' })], null),
    );
    fireEvent.click(screen.getByTestId('receipts-load-more'));
    await waitFor(() => expect(screen.getByTestId('receipt-row-r-2')).toBeInTheDocument());
    expect(fetchListMock).toHaveBeenLastCalledWith(
      { limit: 20, cursor: 'CURSOR' },
      expect.anything(),
    );
    expect(screen.getAllByTestId(/^receipt-row-/)).toHaveLength(2);
    expect(screen.queryByTestId('receipts-load-more')).not.toBeInTheDocument();
  });
});
