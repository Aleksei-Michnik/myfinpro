import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StarredPayments } from './StarredPayments';

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

describe('StarredPayments', () => {
  it('renders <PaymentsList> with starred=true and limit=5', () => {
    paymentsListProps.mockClear();
    render(<StarredPayments />);
    const props = paymentsListProps.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.limit).toBe(5);
    expect(props.disableInternalAdd).toBe(true);
    expect(props.initialFilters).toMatchObject({ starred: true, sort: 'date_desc' });
  });

  it('header includes the "All starred" link', () => {
    render(<StarredPayments />);
    const link = screen.getByTestId('starred-payments-view-all');
    expect(link.getAttribute('href')).toBe('/payments?starred=1');
  });

  it('passes a custom emptyState node to <PaymentsList>', () => {
    paymentsListProps.mockClear();
    render(<StarredPayments />);
    const props = paymentsListProps.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.emptyState).toBeDefined();
  });

  it('mounts cleanly when re-keyed (refresh-key pattern)', () => {
    const { rerender } = render(<StarredPayments key="a" />);
    rerender(<StarredPayments key="b" />);
    expect(screen.getByTestId('mocked-payments-list')).toBeInTheDocument();
  });
});
