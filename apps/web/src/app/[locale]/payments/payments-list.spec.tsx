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

  // ── Scope ─────────────────────────────────────────────────────────────────

  it('default scope is "all"; filters.scope=all forwarded to <PaymentsList>', () => {
    render(<PaymentsListClient />);
    const props = mockListProps.mock.calls[0][0];
    expect(props.filters).toMatchObject({ scope: 'all' });
    expect(props.lockScope).toBe(true);
  });

  it('?scope=personal pre-populates filters.scope', () => {
    searchString = 'scope=personal';
    render(<PaymentsListClient />);
    expect(mockListProps.mock.calls[0][0].filters.scope).toBe('personal');
  });

  it('?scope=group:g-1 forwards "group:g-1" when user is a member', () => {
    searchString = 'scope=group:g-1';
    render(<PaymentsListClient />);
    expect(mockListProps.mock.calls[0][0].filters.scope).toBe('group:g-1');
  });

  it('?scope=group:unknown shows the no-access message', () => {
    searchString = 'scope=group:unknown';
    render(<PaymentsListClient />);
    expect(screen.getByTestId('payments-page-no-access')).toBeInTheDocument();
    expect(screen.queryByTestId('payments-list-mock')).not.toBeInTheDocument();
  });

  // ── Bug #1 — only one starred control ─────────────────────────────────────

  it('renders exactly one starred control on the page (bug #1 regression)', () => {
    render(<PaymentsListClient />);
    expect(screen.getAllByTestId('starred-filter-toggle')).toHaveLength(1);
  });

  // ── Bug #2 — starred toggle drives the list filter ───────────────────────

  it('?starred=1 reflects in the toggle button AND on filters.starred (bug #2 regression)', () => {
    searchString = 'starred=1';
    render(<PaymentsListClient />);
    expect(screen.getByTestId('starred-filter-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(mockListProps.mock.calls[0][0].filters.starred).toBe(true);
  });

  it('clicking starred toggle calls router.replace with ?starred=1', () => {
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

  // ── Bug #3 — URL-synced filters + Clear filters button ───────────────────

  it('?direction=OUT&q=coffee&from=2026-01-01 pre-populates the filters (bug #3a)', () => {
    searchString = 'direction=OUT&q=coffee&from=2026-01-01';
    render(<PaymentsListClient />);
    expect(mockListProps.mock.calls[0][0].filters).toMatchObject({
      direction: 'OUT',
      search: 'coffee',
      from: '2026-01-01',
    });
  });

  it('PaymentsList.onFiltersChange writes back to the URL via router.replace (bug #3b)', () => {
    render(<PaymentsListClient />);
    const onChange = mockListProps.mock.calls[0][0].onFiltersChange as (
      next: Record<string, unknown>,
    ) => void;
    onChange({ scope: 'all', sort: 'date_desc', direction: 'IN' });
    expect(mockReplace).toHaveBeenCalledWith('/payments?direction=IN');
  });

  it('Clear filters button is hidden when no non-default filter is set', () => {
    render(<PaymentsListClient />);
    expect(screen.queryByTestId('payments-clear-filters')).not.toBeInTheDocument();
  });

  it('Clear filters button is visible when any non-default filter is set', () => {
    searchString = 'starred=1';
    render(<PaymentsListClient />);
    expect(screen.getByTestId('payments-clear-filters')).toBeInTheDocument();
  });

  it('Clear filters button preserves scope and strips other params', () => {
    searchString = 'scope=personal&starred=1&direction=OUT&q=test';
    render(<PaymentsListClient />);
    fireEvent.click(screen.getByTestId('payments-clear-filters'));
    expect(mockReplace).toHaveBeenCalledWith('/payments?scope=personal');
  });

  it('Clear filters button on the all-scope tab strips the URL down to just /payments', () => {
    searchString = 'starred=1&direction=OUT&q=test&sort=amount_desc';
    render(<PaymentsListClient />);
    fireEvent.click(screen.getByTestId('payments-clear-filters'));
    expect(mockReplace).toHaveBeenCalledWith('/payments');
  });
});
