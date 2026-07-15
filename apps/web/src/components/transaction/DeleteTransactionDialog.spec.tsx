import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteTransactionDialog } from './DeleteTransactionDialog';
import type { TransactionSummary } from '@/lib/transaction/types';

// ── Module-level mock state (mutable per test) ────────────────────────────────

let mockUser: { id: string } | null = { id: 'me' };
let mockGroups: { id: string; name: string }[] = [];
const mockRemoveTransaction = vi.fn();

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

vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({
    removeTransaction: mockRemoveTransaction,
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTransaction(p: Partial<TransactionSummary> = {}): TransactionSummary {
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
    parentTransactionId: null,
    createdById: 'me',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  };
}

describe('DeleteTransactionDialog', () => {
  beforeEach(() => {
    mockUser = { id: 'me' };
    mockGroups = [];
    mockRemoveTransaction.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('single accessible scope (personal): default is "this scope" and confirm sends ?scope=personal', async () => {
    mockRemoveTransaction.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      transactionDeleted: true,
      transaction: null,
    });
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(
      <DeleteTransactionDialog
        transaction={makeTransaction()}
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );
    expect((screen.getByTestId('delete-mode-this') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId('delete-mode-all')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delete-transaction-confirm'));
    await waitFor(() =>
      expect(mockRemoveTransaction).toHaveBeenCalledWith(
        'p-1',
        'personal',
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('two accessible scopes (personal + 1 group): defaults to "all" and confirm sends ?scope=all', async () => {
    mockGroups = [{ id: 'g-1', name: 'Family' }];
    mockRemoveTransaction.mockResolvedValueOnce({
      deletedAttributions: 2,
      addedAttributions: 0,
      transactionDeleted: true,
      transaction: null,
    });
    render(
      <DeleteTransactionDialog
        transaction={makeTransaction({
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
    fireEvent.click(screen.getByTestId('delete-transaction-confirm'));
    await waitFor(() =>
      expect(mockRemoveTransaction).toHaveBeenCalledWith('p-1', 'all', expect.any(AbortSignal)),
    );
  });

  it('switching to "this scope" with two accessible: scope picker visible and confirm sends ?scope=group:<id>', async () => {
    mockGroups = [{ id: 'g-1', name: 'Family' }];
    mockRemoveTransaction.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      transactionDeleted: false,
      transaction: null,
    });
    render(
      <DeleteTransactionDialog
        transaction={makeTransaction({
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
    fireEvent.click(screen.getByTestId('delete-transaction-confirm'));
    await waitFor(() =>
      expect(mockRemoveTransaction).toHaveBeenCalledWith(
        'p-1',
        'group:g-1',
        expect.any(AbortSignal),
      ),
    );
  });

  it('zero accessible scopes: shows error and disables Delete', () => {
    // Transaction has personal attribution belonging to a different user and a group not in groupsList.
    render(
      <DeleteTransactionDialog
        transaction={makeTransaction({
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
    expect(screen.getByTestId('delete-transaction-no-access')).toBeInTheDocument();
    expect(screen.getByTestId('delete-transaction-confirm')).toBeDisabled();
  });

  it('API error: shows the message and does not call onDeleted', async () => {
    mockRemoveTransaction.mockRejectedValueOnce(new Error('Boom'));
    const onDeleted = vi.fn();
    render(
      <DeleteTransactionDialog
        transaction={makeTransaction()}
        onClose={vi.fn()}
        onDeleted={onDeleted}
      />,
    );
    fireEvent.click(screen.getByTestId('delete-transaction-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('delete-transaction-error')).toHaveTextContent('Boom'),
    );
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('success: invokes onDeleted then onClose', async () => {
    const result = {
      deletedAttributions: 1,
      addedAttributions: 0,
      transactionDeleted: true,
      transaction: null,
    };
    mockRemoveTransaction.mockResolvedValueOnce(result);
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(
      <DeleteTransactionDialog
        transaction={makeTransaction()}
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );
    fireEvent.click(screen.getByTestId('delete-transaction-confirm'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(result));
    expect(onClose).toHaveBeenCalled();
  });

  it('cancel button calls onClose without calling the API', () => {
    const onClose = vi.fn();
    render(
      <DeleteTransactionDialog
        transaction={makeTransaction()}
        onClose={onClose}
        onDeleted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('delete-transaction-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(mockRemoveTransaction).not.toHaveBeenCalled();
  });

  it('"all" mode label includes the accessible-scope count', () => {
    mockGroups = [{ id: 'g-1', name: 'Family' }];
    render(
      <DeleteTransactionDialog
        transaction={makeTransaction({
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
      <DeleteTransactionDialog
        transaction={makeTransaction({
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
    const list = screen.getByTestId('delete-transaction-accessible-list');
    expect(list.textContent ?? '').not.toContain('Secret Cabal');
    // The "all" label reflects only 2 accessible scopes, not 4.
    expect(screen.getByTestId('delete-mode-all').parentElement?.textContent ?? '').toContain(
      'scopeAll:2',
    );
  });

  it('ESC key closes the dialog', () => {
    const onClose = vi.fn();
    render(
      <DeleteTransactionDialog
        transaction={makeTransaction()}
        onClose={onClose}
        onDeleted={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('singleScope prop forces "this scope" mode and sends that scope on confirm', async () => {
    mockGroups = [{ id: 'g-1', name: 'Family' }];
    mockRemoveTransaction.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      transactionDeleted: false,
      transaction: null,
    });
    render(
      <DeleteTransactionDialog
        transaction={makeTransaction({
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
    fireEvent.click(screen.getByTestId('delete-transaction-confirm'));
    await waitFor(() =>
      expect(mockRemoveTransaction).toHaveBeenCalledWith(
        'p-1',
        'group:g-1',
        expect.any(AbortSignal),
      ),
    );
  });
});
