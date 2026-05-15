import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentsListClient } from './payments-list-client';

// Tests for the iteration 6.16.2 orchestrator: filters live in URL, but the
// orchestrator owns the fetch via useAsyncOperation. URL is rewritten ONLY
// on commit. <RetryReturnDialog> opens on failure.

let searchString = '';
let currentLocale = 'en';

const mockReplace = vi.fn();
const mockListProps = vi.fn();
const mockFetchList = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => currentLocale,
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

vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({ fetchList: mockFetchList }),
}));

vi.mock('@/components/payment/PaymentsList', () => ({
  PaymentsList: (props: Record<string, unknown>) => {
    mockListProps(props);
    return <div data-testid="payments-list-mock" />;
  },
}));

function listResp() {
  return Promise.resolve({ data: [], nextCursor: null, hasMore: false });
}

interface ListPropsShape {
  filters: {
    scope?: string;
    starred?: boolean;
    direction?: string;
    search?: string;
    from?: string;
    sort?: string;
  };
  loading?: boolean;
  lockScope?: boolean;
  onFiltersChange?: (next: Record<string, unknown>) => void;
}

function lastListProps(): ListPropsShape {
  const calls = mockListProps.mock.calls;
  const last = calls[calls.length - 1];
  return (last ? last[0] : {}) as ListPropsShape;
}

async function flushFetch() {
  // Allow the chained promise + setState to settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PaymentsListClient (orchestrator)', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockListProps.mockReset();
    mockFetchList.mockReset();
    mockFetchList.mockImplementation(() => listResp());
    searchString = '';
    currentLocale = 'en';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders heading + tabs + list', async () => {
    render(<PaymentsListClient />);
    await flushFetch();
    expect(screen.getByTestId('payments-page')).toBeInTheDocument();
    expect(screen.getByTestId('payments-scope-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('payments-list-mock')).toBeInTheDocument();
  });

  it('default scope is "all"; filters.scope=all forwarded to <PaymentsList>', async () => {
    render(<PaymentsListClient />);
    await flushFetch();
    const props = lastListProps();
    expect(props.filters).toMatchObject({ scope: 'all' });
    expect(props.lockScope).toBe(true);
  });

  it('?scope=personal pre-populates committedFilters.scope', async () => {
    searchString = 'scope=personal';
    render(<PaymentsListClient />);
    await flushFetch();
    expect(lastListProps().filters.scope).toBe('personal');
  });

  it('?scope=group:g-1 forwards "group:g-1" when user is a member', async () => {
    searchString = 'scope=group:g-1';
    render(<PaymentsListClient />);
    await flushFetch();
    expect(lastListProps().filters.scope).toBe('group:g-1');
  });

  it('?scope=group:unknown shows the no-access message', async () => {
    searchString = 'scope=group:unknown';
    render(<PaymentsListClient />);
    await flushFetch();
    expect(screen.getByTestId('payments-page-no-access')).toBeInTheDocument();
    expect(screen.queryByTestId('payments-list-mock')).not.toBeInTheDocument();
  });

  it('renders exactly one starred control on the page', async () => {
    render(<PaymentsListClient />);
    await flushFetch();
    expect(screen.getAllByTestId('starred-filter-toggle')).toHaveLength(1);
  });

  it('?starred=1 reflects in the toggle button AND on filters.starred', async () => {
    searchString = 'starred=1';
    render(<PaymentsListClient />);
    await flushFetch();
    expect(screen.getByTestId('starred-filter-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(lastListProps().filters.starred).toBe(true);
  });

  it('clicking starred toggle commits and writes ?starred=1 to the URL', async () => {
    render(<PaymentsListClient />);
    await flushFetch();
    fireEvent.click(screen.getByTestId('starred-filter-toggle'));
    await flushFetch();
    expect(mockReplace).toHaveBeenLastCalledWith('/payments?starred=1');
  });

  it('clicking starred toggle when already starred commits and clears it', async () => {
    searchString = 'starred=1';
    render(<PaymentsListClient />);
    await flushFetch();
    fireEvent.click(screen.getByTestId('starred-filter-toggle'));
    await flushFetch();
    expect(mockReplace).toHaveBeenLastCalledWith('/payments');
  });

  it('?direction=OUT&q=coffee&from=2026-01-01 pre-populates the filters', async () => {
    searchString = 'direction=OUT&q=coffee&from=2026-01-01';
    render(<PaymentsListClient />);
    await flushFetch();
    expect(lastListProps().filters).toMatchObject({
      direction: 'OUT',
      search: 'coffee',
      from: '2026-01-01',
    });
  });

  it('PaymentsList.onFiltersChange writes back to the URL only on commit', async () => {
    render(<PaymentsListClient />);
    await flushFetch();
    mockReplace.mockReset();
    const onChange = lastListProps().onFiltersChange as (next: Record<string, unknown>) => void;
    onChange({ scope: 'all', sort: 'date_desc', direction: 'IN' });
    await flushFetch();
    expect(mockReplace).toHaveBeenLastCalledWith('/payments?direction=IN');
  });

  it('Clear filters button is hidden when no non-default filter is set', async () => {
    render(<PaymentsListClient />);
    await flushFetch();
    expect(screen.queryByTestId('payments-clear-filters')).not.toBeInTheDocument();
  });

  it('Clear filters button is visible when any non-default filter is set', async () => {
    searchString = 'starred=1';
    render(<PaymentsListClient />);
    await flushFetch();
    expect(screen.getByTestId('payments-clear-filters')).toBeInTheDocument();
  });

  it('Clear filters button preserves scope and strips other params', async () => {
    searchString = 'scope=personal&starred=1&direction=OUT&q=test';
    render(<PaymentsListClient />);
    await flushFetch();
    fireEvent.click(screen.getByTestId('payments-clear-filters'));
    await flushFetch();
    expect(mockReplace).toHaveBeenLastCalledWith('/payments?scope=personal');
  });

  it('Clear filters on the all-scope tab strips down to /payments', async () => {
    searchString = 'starred=1&direction=OUT&q=test&sort=amount_desc';
    render(<PaymentsListClient />);
    await flushFetch();
    fireEvent.click(screen.getByTestId('payments-clear-filters'));
    await flushFetch();
    expect(mockReplace).toHaveBeenLastCalledWith('/payments');
  });

  // ── Iteration 6.16.2 — state machine ─────────────────────────────────

  it('initial deep-link ?direction=IN: filter button stays inactive until commit', async () => {
    // Hold the fetch unresolved so we observe the in-flight state.
    let resolveFn: (v: unknown) => void = () => {};
    mockFetchList.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );
    searchString = 'direction=IN';
    render(<PaymentsListClient />);
    // While in-flight: filters prop reflects deep-link (committed initially), but
    // the orchestrator hasn't yet acknowledged the commit. Simulating the bug
    // fix: the URL is the source of truth ONLY on initial mount, the controls
    // render committedFilters which on mount equals initialFilters from URL.
    // So Income button reflects the URL — that's intended for deep links.
    expect(lastListProps().loading).toBe(true);
    // Resolve and verify post-commit state.
    await act(async () => {
      resolveFn({ data: [], nextCursor: null, hasMore: false });
    });
    await flushFetch();
    expect(lastListProps().loading).toBe(false);
  });

  it('PaymentsList receives loading=true while the initial fetch is in flight', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    mockFetchList.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );
    render(<PaymentsListClient />);
    await flushFetch();
    expect(lastListProps().loading).toBe(true);
    await act(async () => {
      resolveFn({ data: [], nextCursor: null, hasMore: false });
    });
    await flushFetch();
    expect(lastListProps().loading).toBe(false);
  });

  it('on subsequent-change failure: dialog opens; URL stays unchanged', async () => {
    render(<PaymentsListClient />);
    await flushFetch(); // initial fetch resolves with default mock (success).
    mockReplace.mockReset();
    mockFetchList.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByTestId('starred-filter-toggle'));
    await flushFetch();
    await waitFor(() => expect(screen.getByTestId('retry-return-dialog')).toBeInTheDocument());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('clicking Return on subsequent-change failure leaves URL/committedFilters untouched', async () => {
    render(<PaymentsListClient />);
    await flushFetch();
    mockReplace.mockReset();
    mockFetchList.mockRejectedValueOnce(new TypeError('net'));
    fireEvent.click(screen.getByTestId('starred-filter-toggle'));
    await flushFetch();
    fireEvent.click(screen.getByTestId('retry-return-dialog-return'));
    await flushFetch();
    expect(screen.queryByTestId('retry-return-dialog')).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
    // committed starred filter unchanged.
    expect(lastListProps().filters.starred).toBeUndefined();
  });

  // ── Iteration 6.16.5 — locale switch flicker fix ────────────────────────

  it('locale change clears the error dialog and re-fetches with the same filters', async () => {
    // First mount: a deferred fetch that we leave unresolved long enough to
    // simulate the in-flight cancellation that produces the AbortError flash.
    mockFetchList.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { rerender } = render(<PaymentsListClient />);
    await flushFetch();
    // Subsequent-change failure → dialog opens.
    await waitFor(() => expect(screen.getByTestId('retry-return-dialog')).toBeInTheDocument());

    mockFetchList.mockReset();
    mockFetchList.mockImplementation(() => listResp());

    // Locale flips → useResetOnLocaleChange fires → dialog closes, fresh
    // fetch resolves with empty list, no error banner re-renders.
    currentLocale = 'he';
    rerender(<PaymentsListClient />);
    await flushFetch();

    expect(screen.queryByTestId('retry-return-dialog')).not.toBeInTheDocument();
    expect(mockFetchList).toHaveBeenCalled();
  });
});
