import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptConfirmDialog } from './ReceiptConfirmDialog';
import type { CategoryDto } from '@/lib/payment/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const confirmReceiptMock = vi.fn();
vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({ confirmReceipt: confirmReceiptMock }),
}));

const addToastMock = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

const setLastUsedScopesMock = vi.fn();
vi.mock('@/lib/payment/remember', () => ({
  getLastUsedScopes: () => [{ scope: 'personal' }],
  setLastUsedScopes: (s: unknown) => setLastUsedScopesMock(s),
}));

// Stub the reused pickers so this spec isolates the dialog's own logic.
vi.mock('@/components/payment/PaymentCategoryPicker', () => ({
  PaymentCategoryPicker: ({
    value,
    onChange,
    testId,
  }: {
    value: string | null;
    onChange: (id: string) => void;
    testId?: string;
  }) => (
    <button
      type="button"
      data-testid={testId ?? 'category-picker'}
      data-value={value ?? ''}
      onClick={() => onChange('cat-9')}
    >
      pick-category
    </button>
  ),
}));

vi.mock('@/components/payment/PaymentScopeSelector', () => ({
  PaymentScopeSelector: ({
    value,
    onChange,
  }: {
    value: { scope: string; groupId?: string }[];
    onChange: (v: { scope: string; groupId?: string }[]) => void;
  }) => (
    <button
      type="button"
      data-testid="scope-selector"
      data-count={value.length}
      onClick={() => onChange([{ scope: 'group', groupId: 'g1' }])}
    >
      pick-scopes
    </button>
  ),
}));

const categories: CategoryDto[] = [
  {
    id: 'cat-1',
    slug: 'groceries',
    name: 'Groceries',
    icon: null,
    color: null,
    direction: 'OUT',
    ownerType: 'system',
    ownerId: null,
    isSystem: true,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  } as CategoryDto,
];

function renderDialog(props: Partial<React.ComponentProps<typeof ReceiptConfirmDialog>> = {}) {
  const onCancel = vi.fn();
  const onConfirmed = vi.fn();
  render(
    <ReceiptConfirmDialog
      open
      receiptId="r-1"
      categories={categories}
      defaultCategoryId="cat-1"
      onCancel={onCancel}
      onConfirmed={onConfirmed}
      {...props}
    />,
  );
  return { onCancel, onConfirmed };
}

describe('ReceiptConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmReceiptMock.mockResolvedValue({ paymentId: 'p-1' });
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId('receipt-confirm-dialog')).toBeNull();
  });

  it('seeds the category from defaultCategoryId and scopes from last-used', () => {
    renderDialog();
    expect(screen.getByTestId('receipt-confirm-category')).toHaveAttribute('data-value', 'cat-1');
    expect(screen.getByTestId('scope-selector')).toHaveAttribute('data-count', '1');
  });

  it('confirms with the selected category, scopes, and trimmed note', async () => {
    const { onConfirmed } = renderDialog();
    fireEvent.change(screen.getByTestId('receipt-confirm-note'), {
      target: { value: '  weekly shop  ' },
    });
    fireEvent.click(screen.getByTestId('receipt-confirm-submit'));

    await waitFor(() =>
      expect(confirmReceiptMock).toHaveBeenCalledWith(
        'r-1',
        { categoryId: 'cat-1', attributions: [{ scope: 'personal' }], note: 'weekly shop' },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith('p-1'));
    expect(setLastUsedScopesMock).toHaveBeenCalledWith([{ scope: 'personal' }]);
    expect(addToastMock).toHaveBeenCalledWith('success', 'confirmedToast');
  });

  it('sends note undefined when the field is empty, and picks up scope changes', async () => {
    renderDialog();
    fireEvent.click(screen.getByTestId('scope-selector')); // → group g1
    fireEvent.click(screen.getByTestId('receipt-confirm-submit'));

    await waitFor(() =>
      expect(confirmReceiptMock).toHaveBeenCalledWith(
        'r-1',
        { categoryId: 'cat-1', attributions: [{ scope: 'group', groupId: 'g1' }], note: undefined },
        expect.anything(),
      ),
    );
  });

  it('blocks submit without a category', () => {
    renderDialog({ defaultCategoryId: null });
    fireEvent.click(screen.getByTestId('receipt-confirm-submit'));
    expect(addToastMock).toHaveBeenCalledWith('error', 'missingCategory');
    expect(confirmReceiptMock).not.toHaveBeenCalled();
  });

  it('surfaces an error toast when confirmation fails and does not navigate', async () => {
    confirmReceiptMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 400 }));
    const { onConfirmed } = renderDialog();
    fireEvent.click(screen.getByTestId('receipt-confirm-submit'));
    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('boom')),
    );
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('cancel invokes onCancel', () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByTestId('receipt-confirm-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
