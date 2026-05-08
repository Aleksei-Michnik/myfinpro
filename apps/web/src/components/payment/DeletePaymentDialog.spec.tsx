import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeletePaymentDialog } from './DeletePaymentDialog';
import type { PaymentSummary } from '@/lib/payment/types';

// ── Module-level mock state (mutable per test) ────────────────────────────────

let mockUser: { id: string } | null = { id: 'me' };
let mockGroups: { id: string; name: string }[] = [];
const mockRemovePayment = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (values && typeof values.count === 'number') {
      return `${key}:${values.count}`;
    }
    return key;
  },
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({ groups: mockGroups }),
}));

vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({
    removePayment: mockRemovePayment,
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePayment(p: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    id: p.id ?? 'p-1',
    direction: 'OUT',
    type: 'ONE_TIME',
    amountCents: 1000,
    currency: 'USD',
    occurredAt: '2026-04-25T00:00:00Z',
    status: 'POSTED',
    category: {
      id: 'c-1',
      slug: 'misc',
      name: 'Misc',
      icon: null,
      color: null,
    },
    attributions: p.attributions ?? [
      { scope: 'personal', userId: 'me', groupId: null, groupName: null },
    ],
    note: null,
    commentCount: 0,
    starredByMe: false,
    hasDocuments: false,
    parentPaymentId: null,
    createdById: 'me',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  };
}

describe('DeletePaymentDialog', () => {
  beforeEach(() => {
    mockUser = { id: 'me' };
    mockGroups = [];
    mockRemovePayment.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('single accessible scope (personal): default is "this scope" and confirm sends ?scope=personal', async () => {
    mockRemovePayment.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      paymentDeleted: true,
      payment: null,
    });
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(<DeletePaymentDialog payment={makePayment()} onClose={onClose} onDeleted={onDeleted} />);
    expect((screen.getByTestId('delete-mode-this') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId('delete-mode-all')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delete-payment-confirm'));
    await waitFor(() => expect(mockRemovePayment).toHaveBeenCalledWith('p-1', 'personal'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('two accessible scopes (personal + 1 group): defaults to "all" and confirm sends ?scope=all', async () => {
    mockGroups = [{ id: 'g-1', name: 'Family' }];
    mockRemovePayment.mockResolvedValueOnce({
      deletedAttributions: 2,
      addedAttributions: 0,
      paymentDeleted: true,
      payment: null,
    });
    render(
      <DeletePaymentDialog
        payment={makePayment({
          attributions: [
            {
              scope: 'personal',
              userId: 'me',
              groupId: null,
              groupName: null,
            },
            {
              scope: 'group',
              userId: null,
              groupId: 'g-1',
              groupName: 'Family',
            },
          ],
        })}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    expect((screen.getByTestId('delete-mode-all') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('delete-payment-confirm'));
    await waitFor(() => expect(mockRemovePayment).toHaveBeenCalledWith('p-1', 'all'));
  });

  it('switching to "this scope" with two accessible: scope picker visible and confirm sends ?scope=group:<id>', async () => {
    mockGroups = [{ id: 'g-1', name: 'Family' }];
    mockRemovePayment.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      paymentDeleted: false,
      payment: null,
    });
    render(
      <DeletePaymentDialog
        payment={makePayment({
          attributions: [
            {
              scope: 'personal',
              userId: 'me',
              groupId: null,
              groupName: null,
            },
            {
              scope: 'group',
              userId: null,
              groupId: 'g-1',
              groupName: 'Family',
            },
          ],
        })}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('delete-mode-this'));
    expect(screen.getByTestId('delete-scope-picker')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delete-scope-pick-group:g-1'));
    fireEvent.click(screen.getByTestId('delete-payment-confirm'));
    await waitFor(() => expect(mockRemovePayment).toHaveBeenCalledWith('p-1', 'group:g-1'));
  });

  it('zero accessible scopes: shows error and disables Delete', () => {
    // Payment has personal attribution belonging to a different user and a group not in groupsList.
    render(
      <DeletePaymentDialog
        payment={makePayment({
          attributions: [
            {
              scope: 'personal',
              userId: 'someone-else',
              groupId: null,
              groupName: null,
            },
            {
              scope: 'group',
              userId: null,
              groupId: 'unknown',
              groupName: 'Hidden',
            },
          ],
        })}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    expect(screen.getByTestId('delete-payment-no-access')).toBeInTheDocument();
    expect(screen.getByTestId('delete-payment-confirm')).toBeDisabled();
  });

  it('API error: shows the message and does not call onDeleted', async () => {
    mockRemovePayment.mockRejectedValueOnce(new Error('Boom'));
    const onDeleted = vi.fn();
    render(<DeletePaymentDialog payment={makePayment()} onClose={vi.fn()} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByTestId('delete-payment-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('delete-payment-error')).toHaveTextContent('Boom'),
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('success: invokes onDeleted then onClose', async () => {
    const result = {
      deletedAttributions: 1,
      addedAttributions: 0,
      paymentDeleted: true,
      payment: null,
    };
    mockRemovePayment.mockResolvedValueOnce(result);
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(<DeletePaymentDialog payment={makePayment()} onClose={onClose} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByTestId('delete-payment-confirm'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(result));
    expect(onClose).toHaveBeenCalled();
  });

  it('cancel button calls onClose without calling the API', () => {
    const onClose = vi.fn();
    render(<DeletePaymentDialog payment={makePayment()} onClose={onClose} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByTestId('delete-payment-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(mockRemovePayment).not.toHaveBeenCalled();
  });

  it('"all" mode label includes the accessible-scope count', () => {
    mockGroups = [{ id: 'g-1', name: 'Family' }];
    render(
      <DeletePaymentDialog
        payment={makePayment({
          attributions: [
            {
              scope: 'personal',
              userId: 'me',
              groupId: null,
              groupName: null,
            },
            {
              scope: 'group',
              userId: null,
              groupId: 'g-1',
              groupName: 'Family',
            },
          ],
        })}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    // The mock useTranslations returns "scopeAll:2" when count=2.
    const label = screen.getByTestId('delete-mode-all').parentElement;
    expect(label?.textContent ?? '').toContain('scopeAll:2');
  });

  it('non-accessible attributions are NOT shown in the accessible list (security)', () => {
    mockGroups = [{ id: 'g-1', name: 'Family' }];
    render(
      <DeletePaymentDialog
        payment={makePayment({
          attributions: [
            // Accessible.
            {
              scope: 'personal',
              userId: 'me',
              groupId: null,
              groupName: null,
            },
            {
              scope: 'group',
              userId: null,
              groupId: 'g-1',
              groupName: 'Family',
            },
            // NOT accessible — different user.
            {
              scope: 'personal',
              userId: 'someone-else',
              groupId: null,
              groupName: null,
            },
            // NOT accessible — group not in caller's groups.
            {
              scope: 'group',
              userId: null,
              groupId: 'g-secret',
              groupName: 'Secret Cabal',
            },
          ],
        })}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    const list = screen.getByTestId('delete-payment-accessible-list');
    expect(list.textContent ?? '').not.toContain('Secret Cabal');
    // The "all" label reflects only 2 accessible scopes, not 4.
    expect(screen.getByTestId('delete-mode-all').parentElement?.textContent ?? '').toContain(
      'scopeAll:2',
    );
  });

  it('ESC key closes the dialog', () => {
    const onClose = vi.fn();
    render(<DeletePaymentDialog payment={makePayment()} onClose={onClose} onDeleted={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('singleScope prop forces "this scope" mode and sends that scope on confirm', async () => {
    mockGroups = [{ id: 'g-1', name: 'Family' }];
    mockRemovePayment.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      paymentDeleted: false,
      payment: null,
    });
    render(
      <DeletePaymentDialog
        payment={makePayment({
          attributions: [
            {
              scope: 'personal',
              userId: 'me',
              groupId: null,
              groupName: null,
            },
            {
              scope: 'group',
              userId: null,
              groupId: 'g-1',
              groupName: 'Family',
            },
          ],
        })}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
        singleScope="group:g-1"
      />,
    );
    expect(screen.queryByTestId('delete-mode-all')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delete-payment-confirm'));
    await waitFor(() => expect(mockRemovePayment).toHaveBeenCalledWith('p-1', 'group:g-1'));
  });
});
