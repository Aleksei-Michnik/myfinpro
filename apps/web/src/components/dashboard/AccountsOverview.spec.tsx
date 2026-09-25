import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsOverview, netPositions } from './AccountsOverview';
import type { AccountSummary } from '@/lib/account/types';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', defaultCurrency: 'ILS' } }),
}));
const fetchAccountsMock = vi.fn();
vi.mock('@/lib/account/account-context', () => ({
  useAccounts: () => ({ fetchAccounts: fetchAccountsMock }),
}));

function account(overrides: Partial<AccountSummary>): AccountSummary {
  return {
    id: 'a',
    name: 'Account',
    kind: 'BANK',
    institution: null,
    currency: 'ILS',
    last4: null,
    color: null,
    scopeType: 'personal',
    ownerId: 'u1',
    groupId: null,
    openingBalanceCents: 0,
    openingBalanceAt: '2026-01-01T00:00:00.000Z',
    reportedBalanceCents: null,
    reportedBalanceAt: null,
    billingAccountId: null,
    billingDay: null,
    archivedAt: null,
    createdById: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ledgerBalanceCents: 0,
    ledgerBalanceAt: '2026-09-25T00:00:00.000Z',
    pendingLinesCount: 0,
    reconciliationGapCents: null,
    ...overrides,
  };
}

describe('netPositions', () => {
  it('sums per currency with the default currency first', () => {
    const rows = netPositions(
      [
        account({ id: '1', currency: 'USD', ledgerBalanceCents: 100 }),
        account({ id: '2', currency: 'ILS', ledgerBalanceCents: 250 }),
        account({ id: '3', currency: 'ILS', ledgerBalanceCents: -50 }),
      ],
      'ILS',
    );
    expect(rows).toEqual([
      { currency: 'ILS', cents: 200 },
      { currency: 'USD', cents: 100 },
    ]);
  });
});

describe('AccountsOverview', () => {
  beforeEach(() => fetchAccountsMock.mockReset());

  it('renders the net position, one row per account and the pending nudge', async () => {
    fetchAccountsMock.mockResolvedValue({
      data: [
        account({ id: 'a1', name: 'Bank', ledgerBalanceCents: 100000 }),
        account({
          id: 'a2',
          name: 'Card',
          kind: 'CARD',
          ledgerBalanceCents: -2500,
          pendingLinesCount: 2,
          reconciliationGapCents: 999,
        }),
      ],
      nextCursor: null,
      hasMore: false,
    });
    render(<AccountsOverview />);
    await waitFor(() => expect(screen.getByTestId('accounts-overview-rows')).toBeInTheDocument());
    expect(screen.getByTestId('accounts-overview-net-ILS')).toHaveTextContent('₪975.00');
    expect(screen.getByTestId('accounts-overview-row-a2')).toHaveTextContent('owed');
    expect(screen.getByTestId('accounts-overview-pending-a2')).toHaveAttribute(
      'href',
      '/accounts/a2?tab=review',
    );
    expect(screen.getByTestId('accounts-overview-manage')).toHaveAttribute('href', '/accounts');
  });

  it('shows the empty state with the create action', async () => {
    fetchAccountsMock.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    const onNew = vi.fn();
    render(<AccountsOverview onNewAccount={onNew} />);
    await waitFor(() => expect(screen.getByTestId('accounts-overview-empty')).toBeInTheDocument());
    screen.getByRole('button', { name: 'newAccount' }).click();
    expect(onNew).toHaveBeenCalled();
  });

  it('shows an inline error with retry when the fetch fails', async () => {
    fetchAccountsMock.mockRejectedValueOnce(new Error('boom'));
    render(<AccountsOverview />);
    await waitFor(() => expect(screen.getByTestId('accounts-overview-error')).toBeInTheDocument());
  });
});
