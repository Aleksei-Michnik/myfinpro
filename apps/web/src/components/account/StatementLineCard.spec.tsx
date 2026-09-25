import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  StatementLineCard,
  accountScope,
  candidatesOf,
  initialDecision,
  isDecisionReady,
} from './StatementLineCard';
import type { AccountSummary, StatementLine } from '@/lib/account/types';
import type { TransactionSummary } from '@/lib/transaction/types';

vi.mock('next-intl', async () => (await import('@/test-utils/real-messages')).realMessagesIntl());
vi.mock('@/lib/group/group-context', () => ({ useGroups: () => ({ groups: [] }) }));
vi.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/lib/account/account-context', () => ({ useOptionalAccounts: () => null }));
// Stable identities: the picker's effect depends on `listCategories`.
const listCategories = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({ listCategories }),
}));

const account = {
  id: 'acc',
  scopeType: 'personal',
  groupId: null,
  currency: 'ILS',
  kind: 'BANK',
} as AccountSummary;

function tx(id: string, note = ''): TransactionSummary {
  return {
    id,
    direction: 'OUT',
    type: 'ONE_TIME',
    amountCents: 4590,
    currency: 'ILS',
    occurredAt: '2026-09-22T10:00:00.000Z',
    status: 'POSTED',
    categories: [{ id: 'c', slug: 'groceries', name: 'Groceries', icon: null, color: null }],
    attributions: [{ scope: 'personal', userId: 'u1', groupId: null, groupName: null }],
    note,
    commentCount: 0,
    starredByMe: false,
    hasDocuments: false,
  } as TransactionSummary;
}

function line(over: Partial<StatementLine> = {}): StatementLine {
  return {
    id: 'l1',
    accountId: 'acc',
    importId: 'imp',
    postedAt: '2026-09-22',
    direction: 'OUT',
    amountCents: 4590,
    currency: 'ILS',
    description: 'SHUFERSAL',
    normalizedDescription: 'shufersal',
    status: 'PENDING',
    createdAt: '2026-09-25T00:00:00.000Z',
    ...over,
  };
}

describe('decision helpers', () => {
  it('seeds the decision from the suggestion and falls back to create', () => {
    expect(
      initialDecision(
        line({
          suggestion: { action: 'match', score: 0.9, transaction: tx('t1'), candidates: [] },
        }),
        account,
      ),
    ).toEqual({ kind: 'match', transactionId: 't1' });
    expect(
      initialDecision(
        line({
          suggestion: { action: 'transfer', score: 1, transferAccountId: 'card', candidates: [] },
        }),
        account,
      ),
    ).toEqual({ kind: 'transfer', transferAccountId: 'card' });
    expect(
      initialDecision(
        line({ suggestion: { action: 'create', score: 0.4, categoryId: 'c', candidates: [] } }),
        account,
      ),
    ).toEqual({ kind: 'create', categoryId: 'c', scope: { scope: 'personal' } });
    expect(initialDecision(line({ suggestion: null }), account)).toEqual({
      kind: 'create',
      categoryId: null,
      scope: { scope: 'personal' },
    });
  });

  it('is ready only with a target', () => {
    expect(isDecisionReady({ kind: 'match', transactionId: null })).toBe(false);
    expect(
      isDecisionReady({ kind: 'create', categoryId: null, scope: { scope: 'personal' } }),
    ).toBe(false);
    expect(isDecisionReady({ kind: 'transfer', transferAccountId: 'x' })).toBe(true);
    expect(isDecisionReady({ kind: 'ignore' })).toBe(true);
  });

  it('puts the suggested transaction first among the candidates without repeating it', () => {
    const l = line({
      suggestion: {
        action: 'match',
        score: 0.9,
        transaction: tx('t1'),
        candidates: [
          { transaction: tx('t2'), score: 0.7 },
          { transaction: tx('t1'), score: 0.9 },
        ],
      },
    });
    expect(candidatesOf(l).map((c) => c.transaction.id)).toEqual(['t2', 't1']);
    expect(
      candidatesOf(
        line({
          suggestion: { action: 'match', score: 0.9, transaction: tx('t1'), candidates: [] },
        }),
      ).map((c) => c.transaction.id),
    ).toEqual(['t1']);
  });

  it('maps the account scope to an attribution', () => {
    expect(accountScope({ scopeType: 'group', groupId: 'g1' })).toEqual({
      scope: 'group',
      groupId: 'g1',
    });
    expect(accountScope({ scopeType: 'personal', groupId: null })).toEqual({ scope: 'personal' });
  });
});

describe('StatementLineCard', () => {
  const noop = () => undefined;

  it('renders a match suggestion with its candidate and the accept action', () => {
    const l = line({
      suggestion: { action: 'match', score: 0.92, transaction: tx('t1', 'weekly'), candidates: [] },
    });
    render(
      <ul>
        <StatementLineCard
          line={l}
          account={account}
          decision={{ kind: 'match', transactionId: 't1' }}
          onDecisionChange={noop}
          active
          busy={false}
          onAccept={noop}
          onSkip={noop}
          onIgnore={noop}
          candidatesOpen={false}
          onCandidatesOpenChange={noop}
        />
      </ul>,
    );
    expect(screen.getByTestId('line-description-l1')).toHaveTextContent('SHUFERSAL');
    expect(screen.getByTestId('line-amount-l1')).toHaveTextContent('-₪45.90');
    expect(screen.getByTestId('line-candidate-l1')).toHaveTextContent('Groceries · weekly');
    expect(screen.getByTestId('line-candidate-l1')).toHaveTextContent('92% match');
    expect(screen.getByTestId('line-accept-l1')).toBeEnabled();
    expect(screen.getByTestId('line-row-l1').textContent).not.toMatch(/accounts\.[a-z]+\./);
  });

  it('flags a create without a category and disables accept', () => {
    render(
      <ul>
        <StatementLineCard
          line={line({ suggestion: null })}
          account={account}
          decision={{ kind: 'create', categoryId: null, scope: { scope: 'personal' } }}
          onDecisionChange={noop}
          active={false}
          busy={false}
          onAccept={noop}
          onSkip={noop}
          onIgnore={noop}
          candidatesOpen={false}
          onCandidatesOpenChange={noop}
        />
      </ul>,
    );
    expect(screen.getByTestId('line-needs-category-l1')).toHaveTextContent('Needs a category');
    expect(screen.getByTestId('line-accept-l1')).toBeDisabled();
  });

  it('shows the decision and an undo action on a decided row', () => {
    const onUndo = vi.fn();
    render(
      <ul>
        <StatementLineCard
          line={line({ status: 'MATCHED' })}
          account={account}
          decision={{ kind: 'ignore' }}
          onDecisionChange={noop}
          active={false}
          busy={false}
          onAccept={noop}
          onSkip={noop}
          onIgnore={noop}
          onUndo={onUndo}
          candidatesOpen={false}
          onCandidatesOpenChange={noop}
        />
      </ul>,
    );
    expect(screen.getByTestId('line-row-l1')).toHaveTextContent('Matched');
    screen.getByTestId('line-undo-l1').click();
    expect(onUndo).toHaveBeenCalled();
  });
});
