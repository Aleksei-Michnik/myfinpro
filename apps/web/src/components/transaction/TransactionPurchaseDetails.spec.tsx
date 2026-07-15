import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionPurchaseDetails } from './TransactionPurchaseDetails';
import type { ReceiptItem, ReceiptSummary } from '@/lib/receipt/types';

const mockGetReceipt = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({ getReceipt: mockGetReceipt }),
}));

function item(over: Partial<ReceiptItem>): ReceiptItem {
  return {
    id: over.id ?? 'i',
    position: 1,
    rawName: 'x',
    quantity: 1,
    unitPriceCents: null,
    discountCents: 0,
    totalCents: 0,
    categoryId: null,
    productId: null,
    productName: null,
    productBrand: null,
    matchStatus: 'PENDING',
    matchCandidates: [],
    ...over,
  };
}
const receipt = (items: ReceiptItem[]): ReceiptSummary => ({ id: 'r-42', items }) as ReceiptSummary;

describe('TransactionPurchaseDetails (8.18)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is collapsed by default and fetches nothing until expanded', () => {
    render(<TransactionPurchaseDetails receiptId="r-42" currency="USD" />);
    expect(screen.getByTestId('purchase-details-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('purchase-details-panel')).not.toBeInTheDocument();
    expect(mockGetReceipt).not.toHaveBeenCalled();
  });

  it('lazy-loads and lists the products/services on first expand', async () => {
    mockGetReceipt.mockResolvedValueOnce(
      receipt([
        item({
          id: 'i1',
          rawName: 'Milk',
          productName: 'Milk 3%',
          quantity: 2,
          unitPriceCents: 440,
          totalCents: 880,
        }),
        item({ id: 'i2', rawName: 'Bread', totalCents: 1200 }),
      ]),
    );
    render(<TransactionPurchaseDetails receiptId="r-42" currency="USD" />);

    fireEvent.click(screen.getByTestId('purchase-details-toggle'));
    expect(mockGetReceipt).toHaveBeenCalledWith('r-42', expect.anything());

    await waitFor(() => expect(screen.getByTestId('purchase-details-items')).toBeInTheDocument());
    expect(screen.getAllByTestId('purchase-details-item')).toHaveLength(2);
    expect(screen.getByText('Milk 3%')).toBeInTheDocument();
    // Amounts render in the TRANSACTION currency.
    expect(screen.getByText(/\$8\.80/)).toBeInTheDocument();
    expect(screen.getByTestId('purchase-details-receipt-link')).toHaveAttribute(
      'href',
      '/receipts/r-42',
    );
    expect(screen.getByTestId('purchase-details-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('fetches only once across collapse/expand toggles', async () => {
    mockGetReceipt.mockResolvedValueOnce(receipt([item({ id: 'i1', totalCents: 100 })]));
    render(<TransactionPurchaseDetails receiptId="r-42" currency="USD" />);
    const toggle = screen.getByTestId('purchase-details-toggle');

    fireEvent.click(toggle); // open + fetch
    await waitFor(() => expect(screen.getByTestId('purchase-details-items')).toBeInTheDocument());
    fireEvent.click(toggle); // collapse
    fireEvent.click(toggle); // re-open
    expect(mockGetReceipt).toHaveBeenCalledTimes(1);
  });

  it('shows an empty note when the receipt has no line items', async () => {
    mockGetReceipt.mockResolvedValueOnce(receipt([]));
    render(<TransactionPurchaseDetails receiptId="r-42" currency="USD" />);
    fireEvent.click(screen.getByTestId('purchase-details-toggle'));
    await waitFor(() => expect(screen.getByTestId('purchase-details-empty')).toBeInTheDocument());
  });

  it('shows an "unavailable" note when the receipt is not readable by this viewer (404)', async () => {
    mockGetReceipt.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    render(<TransactionPurchaseDetails receiptId="r-42" currency="USD" />);
    fireEvent.click(screen.getByTestId('purchase-details-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('purchase-details-unavailable')).toBeInTheDocument(),
    );
  });
});
