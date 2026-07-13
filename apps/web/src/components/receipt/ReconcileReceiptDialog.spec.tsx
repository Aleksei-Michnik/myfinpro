import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconcileReceiptDialog } from './ReconcileReceiptDialog';
import type { CategoryDto, PaymentSummary } from '@/lib/payment/types';
import type { ReceiptItem, ReceiptSummary } from '@/lib/receipt/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));

const getPaymentMock = vi.fn();
vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({ getPayment: getPaymentMock }),
}));

const reconcileMock = vi.fn();
vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({ reconcileReceipt: reconcileMock }),
}));

const addToastMock = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

const CATS: CategoryDto[] = [
  { id: 'cat-food', name: 'Food' } as CategoryDto,
  { id: 'cat-dining', name: 'Dining' } as CategoryDto,
];

function item(over: Partial<ReceiptItem>): ReceiptItem {
  return {
    id: over.id ?? 'i',
    position: 1,
    rawName: 'x',
    quantity: 1,
    unitPriceCents: null,
    discountCents: 0,
    totalCents: over.totalCents ?? 0,
    categoryId: over.categoryId ?? null,
    productId: null,
    productName: null,
    productBrand: null,
    matchStatus: 'PENDING',
    matchCandidates: [],
  };
}

function receipt(over: Partial<ReceiptSummary> = {}): ReceiptSummary {
  return {
    id: 'r-1',
    status: 'REVIEW',
    paymentId: 'pay-1',
    currency: 'USD',
    totalCents: 4200,
    items: [
      item({ id: 'i1', categoryId: 'cat-dining', totalCents: 3000 }),
      item({ id: 'i2', categoryId: 'cat-food', totalCents: 1200 }),
    ],
    ...over,
  } as ReceiptSummary;
}

const cat = (id: string, name: string): PaymentSummary['category'] => ({
  id,
  name,
  slug: id,
  icon: null,
  color: null,
});

function payment(over: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    id: 'pay-1',
    amountCents: 1000,
    currency: 'USD',
    category: cat('cat-food', 'Food'),
    ...over,
  } as PaymentSummary;
}

function renderDialog(r: ReceiptSummary = receipt()) {
  const onCancel = vi.fn();
  const onReconciled = vi.fn();
  render(
    <ReconcileReceiptDialog
      open
      receipt={r}
      categories={CATS}
      onCancel={onCancel}
      onReconciled={onReconciled}
    />,
  );
  return { onCancel, onReconciled };
}

describe('ReconcileReceiptDialog (8.15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcileMock.mockResolvedValue({ id: 'r-1' });
  });

  it('shows both differing fields with the receipt value defaulted', async () => {
    getPaymentMock.mockResolvedValue(payment());
    renderDialog();

    // total: 1000 vs 4200 differs; category: cat-food vs dominant cat-dining differs.
    await waitFor(() => expect(screen.getByTestId('reconcile-field-total')).toBeTruthy());
    expect(screen.getByTestId('reconcile-field-category')).toBeTruthy();
    // Defaults to "take the receipt" for both.
    expect((screen.getByTestId('reconcile-total-update') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('reconcile-category-update') as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('submits the chosen flags and routes to the payment', async () => {
    getPaymentMock.mockResolvedValue(payment());
    const { onReconciled } = renderDialog();
    await waitFor(() => expect(screen.getByTestId('reconcile-field-total')).toBeTruthy());

    // Keep the current total, take the receipt category.
    fireEvent.click(screen.getByTestId('reconcile-total-keep'));
    fireEvent.click(screen.getByTestId('reconcile-submit'));

    await waitFor(() =>
      expect(reconcileMock).toHaveBeenCalledWith(
        'r-1',
        { applyTotal: false, applyCategory: true },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(onReconciled).toHaveBeenCalledWith('pay-1'));
  });

  it('shows the no-differences state when the receipt matches the payment', async () => {
    getPaymentMock.mockResolvedValue(
      payment({ amountCents: 4200, currency: 'USD', category: cat('cat-dining', 'Dining') }),
    );
    renderDialog();

    await waitFor(() => expect(screen.getByTestId('reconcile-match')).toBeTruthy());
    expect(screen.queryByTestId('reconcile-field-total')).toBeNull();
    expect(screen.queryByTestId('reconcile-field-category')).toBeNull();
  });

  it('toasts on a failed reconcile', async () => {
    getPaymentMock.mockResolvedValue(payment());
    reconcileMock.mockRejectedValue(new Error('nope'));
    const { onReconciled } = renderDialog();
    await waitFor(() => expect(screen.getByTestId('reconcile-submit')).toBeTruthy());

    fireEvent.click(screen.getByTestId('reconcile-submit'));

    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('error', 'nope'));
    expect(onReconciled).not.toHaveBeenCalled();
  });
});
