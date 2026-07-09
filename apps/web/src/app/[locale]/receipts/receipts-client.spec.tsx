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
    mimeType: 'image/jpeg',
    sizeBytes: 1234,
    sourceUrl: null,
    merchantId: null,
    merchantName: null,
    extractedMerchantName: null,
    purchasedAt: null,
    currency: null,
    totalCents: null,
    discountCents: null,
    failureReason: null,
    paymentId: null,
    itemsSumCents: 0,
    totalsMismatchCents: null,
    createdAt: '2026-07-04T10:00:00.000Z',
    updatedAt: '2026-07-04T10:00:00.000Z',
    items: [],
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

  it('uploads dropped files, prepends the row, and toasts', async () => {
    render(<ReceiptsClient />);
    await waitFor(() => expect(fetchListMock).toHaveBeenCalled());
    uploadReceiptMock.mockResolvedValue(makeReceipt({ id: 'r-new' }));

    const file = new File(['x'], 'r.jpg', { type: 'image/jpeg' });
    fireEvent.drop(screen.getByTestId('receipt-dropzone'), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByTestId('receipt-row-r-new')).toBeInTheDocument());
    expect(uploadReceiptMock).toHaveBeenCalledWith(file, expect.anything());
    expect(addToastMock).toHaveBeenCalledWith('success', 'upload.uploadedToast:1');
  });

  it('adds URL receipts through the form', async () => {
    render(<ReceiptsClient />);
    await waitFor(() => expect(fetchListMock).toHaveBeenCalled());
    createFromUrlMock.mockResolvedValue(makeReceipt({ id: 'r-url', source: 'url' }));

    fireEvent.change(screen.getByTestId('receipt-url-input'), {
      target: { value: 'https://r.example/x' },
    });
    fireEvent.click(screen.getByTestId('receipt-url-submit'));

    await waitFor(() => expect(screen.getByTestId('receipt-row-r-url')).toBeInTheDocument());
    expect(createFromUrlMock).toHaveBeenCalledWith('https://r.example/x', expect.anything());
  });

  it('a failed upload surfaces an error toast', async () => {
    render(<ReceiptsClient />);
    await waitFor(() => expect(fetchListMock).toHaveBeenCalled());
    uploadReceiptMock.mockRejectedValue(new Error('Unsupported file type'));

    fireEvent.drop(screen.getByTestId('receipt-dropzone'), {
      dataTransfer: { files: [new File(['x'], 'x.gif', { type: 'image/gif' })] },
    });
    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('Unsupported')),
    );
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
