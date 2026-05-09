import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GroupPaymentsTab } from './GroupPaymentsTab';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}));

const mockPaymentsList = vi.fn();
vi.mock('@/components/payment/PaymentsList', () => ({
  PaymentsList: (props: Record<string, unknown>) => {
    mockPaymentsList(props);
    return <div data-testid="payments-list-mock">PaymentsList</div>;
  },
}));

describe('GroupPaymentsTab', () => {
  it('renders the section with heading', () => {
    render(<GroupPaymentsTab groupId="g-1" />);
    expect(screen.getByTestId('group-payments-tab')).toBeInTheDocument();
  });

  it('mounts the PaymentsList', () => {
    render(<GroupPaymentsTab groupId="g-1" />);
    expect(screen.getByTestId('payments-list-mock')).toBeInTheDocument();
  });

  it('forwards scope=group:<id> to PaymentsList', () => {
    mockPaymentsList.mockClear();
    render(<GroupPaymentsTab groupId="g-1" />);
    expect(mockPaymentsList).toHaveBeenCalledWith(expect.objectContaining({ scope: 'group:g-1' }));
  });

  it('passes initialFilters with scope+sort', () => {
    mockPaymentsList.mockClear();
    render(<GroupPaymentsTab groupId="g-7" />);
    const props = mockPaymentsList.mock.calls[0][0];
    expect(props.initialFilters).toEqual({ scope: 'group:g-7', sort: 'date_desc' });
    expect(props.showFilters).toBe(true);
    expect(props.showStar).toBe(true);
  });
});
