import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecentActivity } from './RecentActivity';

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

describe('RecentActivity', () => {
  it('renders <TransactionsList> with the expected props', () => {
    transactionsListProps.mockClear();
    render(<RecentActivity />);
    const props = transactionsListProps.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.limit).toBe(10);
    expect(props.showFilters).toBe(false);
    expect(props.disableInternalAdd).toBe(true);
    expect(props.showStar).toBe(true);
    expect(props.filters).toMatchObject({ scope: 'all', sort: 'date_desc' });
  });

  it('header includes a "View all" link to /transactions', () => {
    render(<RecentActivity />);
    const link = screen.getByTestId('recent-activity-view-all');
    expect(link.getAttribute('href')).toBe('/transactions');
  });

  it('forwards a custom empty-state node to <TransactionsList>', () => {
    transactionsListProps.mockClear();
    render(<RecentActivity />);
    const props = transactionsListProps.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.emptyState).toBeDefined();
  });

  it('mounts cleanly when re-keyed (refresh-key pattern)', () => {
    const { rerender } = render(<RecentActivity key="a" />);
    rerender(<RecentActivity key="b" />);
    expect(screen.getByTestId('mocked-transactions-list')).toBeInTheDocument();
  });

  it('defaults limit=10 but accepts an override', () => {
    transactionsListProps.mockClear();
    render(<RecentActivity limit={3} />);
    const props = transactionsListProps.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.limit).toBe(3);
  });
});
