import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PaymentsListClient } from './payments-list-client';

let searchString = '';

const mockReplace = vi.fn();
const mockListProps = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchString),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
  usePathname: () => '/payments',
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({
    groups: [
      {
        id: 'g-1',
        name: 'Family',
        type: 'family',
        defaultCurrency: 'USD',
        createdById: 'me',
        createdAt: '',
        updatedAt: '',
        memberCount: 2,
      },
    ],
  }),
}));

vi.mock('@/components/payment/PaymentsList', () => ({
  PaymentsList: (props: Record<string, unknown>) => {
    mockListProps(props);
    return <div data-testid="payments-list-mock" />;
  },
}));

describe('PaymentsListClient', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockListProps.mockReset();
    searchString = '';
  });

  it('renders heading + tabs + list', () => {
    render(<PaymentsListClient />);
    expect(screen.getByTestId('payments-page')).toBeInTheDocument();
    expect(screen.getByTestId('payments-scope-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('payments-list-mock')).toBeInTheDocument();
  });

  it('default scope is "all"', () => {
    searchString = '';
    render(<PaymentsListClient />);
    const props = mockListProps.mock.calls[0][0];
    expect(props.scope).toBe('all');
  });

  it('?scope=personal forwards "personal" to PaymentsList', () => {
    searchString = 'scope=personal';
    render(<PaymentsListClient />);
    const props = mockListProps.mock.calls[0][0];
    expect(props.scope).toBe('personal');
    expect(props.initialFilters.scope).toBe('personal');
  });

  it('?scope=group:g-1 forwards "group:g-1" when user is a member', () => {
    searchString = 'scope=group:g-1';
    render(<PaymentsListClient />);
    const props = mockListProps.mock.calls[0][0];
    expect(props.scope).toBe('group:g-1');
  });

  it('?scope=group:unknown shows the no-access message', () => {
    searchString = 'scope=group:unknown';
    render(<PaymentsListClient />);
    expect(screen.getByTestId('payments-page-no-access')).toBeInTheDocument();
    expect(screen.queryByTestId('payments-list-mock')).not.toBeInTheDocument();
  });

  it('?starred=1 reflects in the starred toggle button', () => {
    searchString = 'starred=1';
    render(<PaymentsListClient />);
    expect(screen.getByTestId('starred-filter-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking starred toggle calls router.replace with ?starred=1', () => {
    searchString = '';
    render(<PaymentsListClient />);
    fireEvent.click(screen.getByTestId('starred-filter-toggle'));
    expect(mockReplace).toHaveBeenCalledWith('/payments?starred=1');
  });

  it('clicking starred toggle when already starred clears it', () => {
    searchString = 'starred=1';
    render(<PaymentsListClient />);
    fireEvent.click(screen.getByTestId('starred-filter-toggle'));
    expect(mockReplace).toHaveBeenCalledWith('/payments');
  });
});
