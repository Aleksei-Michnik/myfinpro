import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecentActivity } from './RecentActivity';

const paymentsListProps = vi.fn();

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

vi.mock('@/components/payment/PaymentsList', () => ({
  PaymentsList: (props: Record<string, unknown>) => {
    paymentsListProps(props);
    return <div data-testid="mocked-payments-list" />;
  },
}));

describe('RecentActivity', () => {
  it('renders <PaymentsList> with the expected props', () => {
    paymentsListProps.mockClear();
    render(<RecentActivity />);
    const props = paymentsListProps.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.limit).toBe(10);
    expect(props.showFilters).toBe(false);
    expect(props.disableInternalAdd).toBe(true);
    expect(props.showStar).toBe(true);
    expect(props.initialFilters).toMatchObject({ sort: 'date_desc' });
  });

  it('header includes a "View all" link to /payments', () => {
    render(<RecentActivity />);
    const link = screen.getByTestId('recent-activity-view-all');
    expect(link.getAttribute('href')).toBe('/payments');
  });

  it('forwards a custom empty-state node to <PaymentsList>', () => {
    paymentsListProps.mockClear();
    render(<RecentActivity />);
    const props = paymentsListProps.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.emptyState).toBeDefined();
  });

  it('mounts cleanly when re-keyed (refresh-key pattern)', () => {
    const { rerender } = render(<RecentActivity key="a" />);
    rerender(<RecentActivity key="b" />);
    expect(screen.getByTestId('mocked-payments-list')).toBeInTheDocument();
  });

  it('defaults limit=10 but accepts an override', () => {
    paymentsListProps.mockClear();
    render(<RecentActivity limit={3} />);
    const props = paymentsListProps.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.limit).toBe(3);
  });
});
