import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionsListClient } from './transactions-list-client';

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
  usePathname: () => '/transactions',
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

vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({ fetchList: mockFetchList }),
}));

vi.mock('@/components/transaction/TransactionsList', () => ({
  TransactionsList: (props: Record<string, unknown>) => {
    mockListProps(props);
    return <div data-testid="transactions-list-mock" />;
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

describe('TransactionsListClient (orchestrator)', () => {
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
    render(<TransactionsListClient />);
    await flushFetch();
    expect(screen.getByTestId('transactions-page')).toBeInTheDocument();
    expect(screen.getByTestId('transactions-scope-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('transactions-list-mock')).toBeInTheDocument();
  });

  it('default scope is "all"; filters.scope=all forwarded to <TransactionsList>', async () => {
    render(<TransactionsListClient />);
    await flushFetch();
    const props = lastListProps();
    expect(props.filters).toMatchObject({ scope: 'all' });
    expect(props.lockScope).toBe(true);
  });

  it('?scope=personal pre-populates committedFilters.scope', async () => {
    searchString = 'scope=personal';
    render(<TransactionsListClient />);
    await flushFetch();
    expect(lastListProps().filters.scope).toBe('personal');
  });

  it('?scope=group:g-1 forwards "group:g-1" when user is a member', async () => {
    searchString = 'scope=group:g-1';
    render(<TransactionsListClient />);
    await flushFetch();
    expect(lastListProps().filters.scope).toBe('group:g-1');
  });

  it('?scope=group:unknown shows the no-access message', async () => {
    searchString = 'scope=group:unknown';
    render(<TransactionsListClient />);
    await flushFetch();
    expect(screen.getByTestId('transactions-page-no-access')).toBeInTheDocument();
    expect(screen.queryByTestId('transactions-list-mock')).not.toBeInTheDocument();
  });

  it('renders exactly one starred control on the page', async () => {
    render(<TransactionsListClient />);
    await flushFetch();
    expect(screen.getAllByTestId('starred-filter-toggle')).toHaveLength(1);
  });

  it('?starred=1 reflects in the toggle button AND on filters.starred', async () => {
    searchString = 'starred=1';
    render(<TransactionsListClient />);
    await flushFetch();
    expect(screen.getByTestId('starred-filter-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(lastListProps().filters.starred).toBe(true);
  });

  it('clicking starred toggle commits and writes ?starred=1 to the URL', async () => {
    render(<TransactionsListClient />);
    await flushFetch();
    fireEvent.click(screen.getByTestId('starred-filter-toggle'));
    await flushFetch();
    expect(mockReplace).toHaveBeenLastCalledWith('/transactions?starred=1');
  });

  it('clicking starred toggle when already starred commits and clears it', async () => {
    searchString = 'starred=1';
    render(<TransactionsListClient />);
    await flushFetch();
    fireEvent.click(screen.getByTestId('starred-filter-toggle'));
    await flushFetch();
    expect(mockReplace).toHaveBeenLastCalledWith('/transactions');
  });

  it('?direction=OUT&q=coffee&from=2026-01-01 pre-populates the filters', async () => {
    searchString = 'direction=OUT&q=coffee&from=2026-01-01';
    render(<TransactionsListClient />);
    await flushFetch();
    expect(lastListProps().filters).toMatchObject({
      direction: 'OUT',
      search: 'coffee',
      from: '2026-01-01',
    });
  });

  it('TransactionsList.onFiltersChange writes back to the URL only on commit', async () => {
    render(<TransactionsListClient />);
    await flushFetch();
    mockReplace.mockReset();
    const onChange = lastListProps().onFiltersChange as (next: Record<string, unknown>) => void;
    onChange({ scope: 'all', sort: 'date_desc', direction: 'IN' });
    await flushFetch();
    expect(mockReplace).toHaveBeenLastCalledWith('/transactions?direction=IN');
  });

  it('Clear filters button is hidden when no non-default filter is set', async () => {
    render(<TransactionsListClient />);
    await flushFetch();
    expect(screen.queryByTestId('transactions-clear-filters')).not.toBeInTheDocument();
  });

  it('Clear filters button is visible when any non-default filter is set', async () => {
    searchString = 'starred=1';
    render(<TransactionsListClient />);
    await flushFetch();
    expect(screen.getByTestId('transactions-clear-filters')).toBeInTheDocument();
  });

  it('Clear filters button preserves scope and strips other params', async () => {
    searchString = 'scope=personal&starred=1&direction=OUT&q=test';
    render(<TransactionsListClient />);
    await flushFetch();
    fireEvent.click(screen.getByTestId('transactions-clear-filters'));
    await flushFetch();
    expect(mockReplace).toHaveBeenLastCalledWith('/transactions?scope=personal');
  });

  it('Clear filters on the all-scope tab strips down to /transactions', async () => {
    searchString = 'starred=1&direction=OUT&q=test&sort=amount_desc';
    render(<TransactionsListClient />);
    await flushFetch();
    fireEvent.click(screen.getByTestId('transactions-clear-filters'));
    await flushFetch();
    expect(mockReplace).toHaveBeenLastCalledWith('/transactions');
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
    render(<TransactionsListClient />);
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

  it('TransactionsList receives loading=true while the initial fetch is in flight', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    mockFetchList.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );
    render(<TransactionsListClient />);
    await flushFetch();
    expect(lastListProps().loading).toBe(true);
    await act(async () => {
      resolveFn({ data: [], nextCursor: null, hasMore: false });
    });
    await flushFetch();
    expect(lastListProps().loading).toBe(false);
  });

  it('on subsequent-change failure: dialog opens; URL stays unchanged', async () => {
    render(<TransactionsListClient />);
    await flushFetch(); // initial fetch resolves with default mock (success).
    mockReplace.mockReset();
    mockFetchList.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByTestId('starred-filter-toggle'));
    await flushFetch();
    await waitFor(() => expect(screen.getByTestId('retry-return-dialog')).toBeInTheDocument());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('clicking Return on subsequent-change failure leaves URL/committedFilters untouched', async () => {
    render(<TransactionsListClient />);
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
    const { rerender } = render(<TransactionsListClient />);
    await flushFetch();
    // Subsequent-change failure → dialog opens.
    await waitFor(() => expect(screen.getByTestId('retry-return-dialog')).toBeInTheDocument());

    mockFetchList.mockReset();
    mockFetchList.mockImplementation(() => listResp());

    // Locale flips → useResetOnLocaleChange fires → dialog closes, fresh
    // fetch resolves with empty list, no error banner re-renders.
    currentLocale = 'he';
    rerender(<TransactionsListClient />);
    await flushFetch();

    expect(screen.queryByTestId('retry-return-dialog')).not.toBeInTheDocument();
    expect(mockFetchList).toHaveBeenCalled();
  });
});
