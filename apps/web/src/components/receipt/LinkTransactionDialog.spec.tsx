import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkTransactionDialog } from './LinkTransactionDialog';
import type { ReceiptSummary } from '@/lib/receipt/types';
import type { TransactionSummary } from '@/lib/transaction/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const fetchListMock = vi.fn();
vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({ fetchList: fetchListMock }),
}));

const linkMock = vi.fn();
vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({ linkToTransaction: linkMock }),
}));

const addToastMock = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

vi.mock('@/lib/transaction/formatters', () => ({
  formatAmount: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  formatOccurredDate: () => 'Apr 25',
}));

const tx = (over: Partial<TransactionSummary> = {}): TransactionSummary =>
  ({
    id: 'pay-1',
    direction: 'OUT',
    type: 'ONE_TIME',
    amountCents: 4590,
    currency: 'USD',
    occurredAt: '2026-04-25T00:00:00Z',
    status: 'POSTED',
    category: { id: 'c1', slug: 'groceries', name: 'Groceries', icon: null, color: null },
    attributions: [],
    note: 'Weekly shop',
    commentCount: 0,
    starredByMe: false,
    hasDocuments: false,
    parentTransactionId: null,
    createdById: 'u-1',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
    ...over,
  }) as TransactionSummary;

function renderDialog() {
  const onClose = vi.fn();
  const onLinked = vi.fn();
  render(
    <LinkTransactionDialog
      open
      receiptId="r-1"
      locale="en"
      onClose={onClose}
      onLinked={onLinked}
    />,
  );
  return { onClose, onLinked };
}

describe('LinkTransactionDialog (8.28)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists receiptless OUT transactions the caller created', async () => {
    fetchListMock.mockResolvedValue({ data: [tx()], nextCursor: null, hasMore: false });
    renderDialog();

    await waitFor(() => expect(screen.getByTestId('link-transaction-option-pay-1')).toBeTruthy());
    expect(fetchListMock).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'OUT', hasReceipt: false, createdByMe: true }),
      expect.anything(),
    );
    expect(screen.getByText('Weekly shop')).toBeTruthy();
  });

  it('links the chosen transaction and hands the receipt back', async () => {
    fetchListMock.mockResolvedValue({ data: [tx()], nextCursor: null, hasMore: false });
    const linked = { id: 'r-1', transactionId: 'pay-1', status: 'REVIEW' } as ReceiptSummary;
    linkMock.mockResolvedValue(linked);
    const { onLinked } = renderDialog();

    fireEvent.click(await screen.findByTestId('link-transaction-option-pay-1'));

    await waitFor(() => expect(linkMock).toHaveBeenCalledWith('r-1', 'pay-1', expect.anything()));
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(linked));
  });

  it('shows the empty state when there are no candidates', async () => {
    fetchListMock.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    renderDialog();
    await waitFor(() => expect(screen.getByTestId('link-transaction-empty')).toBeTruthy());
  });

  it('toasts on a link failure and stays open', async () => {
    fetchListMock.mockResolvedValue({ data: [tx()], nextCursor: null, hasMore: false });
    linkMock.mockRejectedValue(new Error('This transaction already has a receipt'));
    const { onLinked } = renderDialog();

    fireEvent.click(await screen.findByTestId('link-transaction-option-pay-1'));

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('already has')),
    );
    expect(onLinked).not.toHaveBeenCalled();
  });
});
