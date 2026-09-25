import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountCard } from './AccountCard';
import type { AccountSummary } from '@/lib/account/types';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function makeAccount(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: 'a1',
    name: 'Main checking',
    kind: 'BANK',
    institution: 'hapoalim',
    currency: 'ILS',
    last4: '1234',
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
    ledgerBalanceCents: 123456,
    ledgerBalanceAt: '2026-09-25T10:00:00.000Z',
    pendingLinesCount: 0,
    reconciliationGapCents: null,
    ...overrides,
  };
}

const noop = () => undefined;

describe('AccountCard', () => {
  it('renders name, kind, institution, masked digits and the ledger balance', () => {
    render(
      <AccountCard
        account={makeAccount()}
        groups={[]}
        onEdit={noop}
        onToggleArchive={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByTestId('account-name-a1')).toHaveTextContent('Main checking');
    expect(screen.getByTestId('account-kind-a1')).toHaveTextContent('kinds.BANK');
    expect(screen.getByTestId('account-institution-a1')).toHaveTextContent('Bank Hapoalim');
    expect(screen.getByTestId('account-last4-a1')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('account-ledger-a1')).toHaveTextContent('₪1,234.56');
    expect(screen.getByTestId('account-actions-a1')).toBeInTheDocument();
    expect(screen.queryByTestId('account-reported-a1')).toBeNull();
  });

  it('shows a negative card balance as an owed amount', () => {
    render(
      <AccountCard
        account={makeAccount({ kind: 'CARD', ledgerBalanceCents: -5000 })}
        groups={[]}
        onEdit={noop}
        onToggleArchive={noop}
        onDelete={noop}
      />,
    );
    const ledger = screen.getByTestId('account-ledger-a1');
    expect(ledger).toHaveTextContent('card.owed');
    expect(ledger).toHaveTextContent('₪50.00');
    expect(ledger).not.toHaveTextContent('-');
  });

  it('renders the reported balance, the gap badge and the pending-lines link', () => {
    render(
      <AccountCard
        account={makeAccount({
          reportedBalanceCents: 130000,
          reportedBalanceAt: '2026-09-20T00:00:00.000Z',
          reconciliationGapCents: 6544,
          pendingLinesCount: 3,
        })}
        groups={[]}
        onEdit={noop}
        onToggleArchive={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByTestId('account-reported-a1')).toHaveTextContent('₪1,300.00');
    expect(screen.getByTestId('account-gap-a1')).toHaveTextContent('card.gap');
    expect(screen.getByTestId('account-pending-a1').closest('a')).toHaveAttribute(
      'href',
      '/accounts/a1?tab=review',
    );
  });

  it('says reconciled when the gap is zero', () => {
    render(
      <AccountCard
        account={makeAccount({ reportedBalanceCents: 123456, reconciliationGapCents: 0 })}
        groups={[]}
        onEdit={noop}
        onToggleArchive={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByTestId('account-gap-a1')).toHaveTextContent('card.reconciled');
  });

  it('hides the actions menu from a plain group member and shows it to an admin', () => {
    const groupAccount = makeAccount({ scopeType: 'group', ownerId: null, groupId: 'g1' });
    const { rerender } = render(
      <AccountCard
        account={groupAccount}
        groups={[{ id: 'g1', name: 'Family', role: 'member' }]}
        onEdit={noop}
        onToggleArchive={noop}
        onDelete={noop}
      />,
    );
    expect(screen.queryByTestId('account-actions-a1')).toBeNull();
    rerender(
      <AccountCard
        account={groupAccount}
        groups={[{ id: 'g1', name: 'Family', role: 'admin' }]}
        onEdit={noop}
        onToggleArchive={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByTestId('account-actions-a1')).toBeInTheDocument();
  });

  it('marks an archived account', () => {
    render(
      <AccountCard
        account={makeAccount({ archivedAt: '2026-09-01T00:00:00.000Z' })}
        groups={[]}
        onEdit={noop}
        onToggleArchive={noop}
        onDelete={noop}
      />,
    );
    expect(screen.getByTestId('account-card-a1')).toHaveAttribute('data-archived', 'true');
    expect(screen.getByTestId('account-archived-a1')).toBeInTheDocument();
  });
});
