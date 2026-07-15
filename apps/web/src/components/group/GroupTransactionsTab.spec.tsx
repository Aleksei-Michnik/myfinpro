import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GroupTransactionsTab } from './GroupTransactionsTab';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}));

const mockTransactionsList = vi.fn();
vi.mock('@/components/transaction/TransactionsList', () => ({
  TransactionsList: (props: Record<string, unknown>) => {
    mockTransactionsList(props);
    return <div data-testid="transactions-list-mock">TransactionsList</div>;
  },
}));

describe('GroupTransactionsTab', () => {
  it('renders the section with heading', () => {
    render(<GroupTransactionsTab groupId="g-1" />);
    expect(screen.getByTestId('group-transactions-tab')).toBeInTheDocument();
  });

  it('mounts the TransactionsList', () => {
    render(<GroupTransactionsTab groupId="g-1" />);
    expect(screen.getByTestId('transactions-list-mock')).toBeInTheDocument();
  });

  it('forwards filters with scope=group:<id> + lockScope to TransactionsList', () => {
    mockTransactionsList.mockClear();
    render(<GroupTransactionsTab groupId="g-1" />);
    expect(mockTransactionsList).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ scope: 'group:g-1' }),
        lockScope: true,
      }),
    );
  });

  it('passes filters with scope+sort + UI flags', () => {
    mockTransactionsList.mockClear();
    render(<GroupTransactionsTab groupId="g-7" />);
    const props = mockTransactionsList.mock.calls[0][0];
    expect(props.filters).toEqual({ scope: 'group:g-7', sort: 'date_desc' });
    expect(props.showFilters).toBe(true);
    expect(props.showStar).toBe(true);
  });
});
