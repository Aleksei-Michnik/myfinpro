import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkReceiptDialog } from './LinkReceiptDialog';
import type { ReceiptSummary } from '@/lib/receipt/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const fetchListMock = vi.fn();
const linkMock = vi.fn();
vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({ fetchList: fetchListMock, linkToTransaction: linkMock }),
}));

const addToastMock = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

vi.mock('@/lib/transaction/formatters', () => ({
  formatAmount: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  formatOccurredDate: () => 'Apr 25',
}));

vi.mock('@/components/receipt/ReceiptStatusPill', () => ({
  ReceiptStatusPill: ({ status }: { status: string }) => <span>{status}</span>,
}));

const receipt = (over: Partial<ReceiptSummary> = {}): ReceiptSummary =>
  ({
    id: 'r-1',
    status: 'REVIEW',
    source: 'upload',
    originalName: 'r.jpg',
    sourceUrl: null,
    merchantId: null,
    merchantName: 'Rami Levy',
    extractedMerchantName: null,
    purchasedAt: '2026-04-25T00:00:00Z',
    currency: 'ILS',
    totalCents: 4590,
    discountCents: null,
    failureReason: null,
    transactionId: null,
    itemsSumCents: 4590,
    totalsMismatchCents: null,
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
    items: [],
    files: [],
    ...over,
  }) as ReceiptSummary;

function renderDialog() {
  const onClose = vi.fn();
  const onLinked = vi.fn();
  render(
    <LinkReceiptDialog
      open
      transactionId="pay-1"
      locale="en"
      onClose={onClose}
      onLinked={onLinked}
    />,
  );
  return { onClose, onLinked };
}

describe('LinkReceiptDialog (8.28)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the caller’s unattached (linkable) receipts', async () => {
    fetchListMock.mockResolvedValue({ data: [receipt()], nextCursor: null, hasMore: false });
    renderDialog();

    await waitFor(() => expect(screen.getByTestId('link-receipt-option-r-1')).toBeTruthy());
    expect(fetchListMock).toHaveBeenCalledWith(
      expect.objectContaining({ linkable: true }),
      expect.anything(),
    );
    expect(screen.getByText('Rami Levy')).toBeTruthy();
  });

  it('links the chosen receipt to the transaction', async () => {
    fetchListMock.mockResolvedValue({ data: [receipt()], nextCursor: null, hasMore: false });
    const linked = receipt({ transactionId: 'pay-1' });
    linkMock.mockResolvedValue(linked);
    const { onLinked } = renderDialog();

    fireEvent.click(await screen.findByTestId('link-receipt-option-r-1'));

    await waitFor(() => expect(linkMock).toHaveBeenCalledWith('r-1', 'pay-1', expect.anything()));
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(linked));
  });

  it('shows the empty state when there is nothing to link', async () => {
    fetchListMock.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    renderDialog();
    await waitFor(() => expect(screen.getByTestId('link-receipt-empty')).toBeTruthy());
  });
});
