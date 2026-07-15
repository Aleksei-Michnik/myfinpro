import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StarredTransactions } from './StarredTransactions';

const transactionsListProps = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/transaction/TransactionsList', () => ({
  TransactionsList: (props: Record<string, unknown>) => {
    transactionsListProps(props);
    return <div data-testid="mocked-transactions-list" />;
  },
}));

describe('StarredTransactions', () => {
  it('renders <TransactionsList> with starred=true and limit=5', () => {
    transactionsListProps.mockClear();
    render(<StarredTransactions />);
    const props = transactionsListProps.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.limit).toBe(5);
    expect(props.disableInternalAdd).toBe(true);
    expect(props.filters).toMatchObject({ scope: 'all', starred: true, sort: 'date_desc' });
  });

  it('header includes the "All starred" link', () => {
    render(<StarredTransactions />);
    const link = screen.getByTestId('starred-transactions-view-all');
    expect(link.getAttribute('href')).toBe('/transactions?starred=1');
  });

  it('passes a custom emptyState node to <TransactionsList>', () => {
    transactionsListProps.mockClear();
    render(<StarredTransactions />);
    const props = transactionsListProps.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.emptyState).toBeDefined();
  });

  it('mounts cleanly when re-keyed (refresh-key pattern)', () => {
    const { rerender } = render(<StarredTransactions key="a" />);
    rerender(<StarredTransactions key="b" />);
    expect(screen.getByTestId('mocked-transactions-list')).toBeInTheDocument();
  });
});
