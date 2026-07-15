import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionsList } from './TransactionsList';
import { RealtimeContext } from '@/lib/realtime/realtime-context';
import { defaultFilters } from '@/lib/transaction/filters';
import type { TransactionSummary } from '@/lib/transaction/types';

// jsdom does not apply Tailwind's `hidden md:block` / `md:hidden` responsive
// rules, so both desktop and mobile variants render simultaneously. Always
// scope row queries to the desktop variant in tests to avoid duplicates.
function inDesktop() {
  return within(screen.getByTestId('transactions-list-desktop'));
}

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockFetchList = vi.fn();
const mockGetTransaction = vi.fn();
const mockRemoveTransaction = vi.fn();
const mockToggleStar = vi.fn();
const mockListCategories = vi.fn();
const mockCreateTransaction = vi.fn();
const mockUpdateTransaction = vi.fn();
const mockRouterPush = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (values && typeof values.message === 'string') {
      return `${key}:${values.message}`;
    }
    if (values && typeof values.count === 'number') {
      return `${key}:${values.count}`;
    }
    return key;
  },
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me' } }),
}));

// <TransactionFormDialog> (mounted on Add/Edit) reads the toast context.
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
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
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        memberCount: 2,
      },
    ],
  }),
}));

vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({
    fetchList: mockFetchList,
    getTransaction: mockGetTransaction,
    removeTransaction: mockRemoveTransaction,
    toggleStar: mockToggleStar,
    listCategories: mockListCategories,
    createTransaction: mockCreateTransaction,
    updateTransaction: mockUpdateTransaction,
  }),
}));

// The create dialog offers receipt intake (7.13); this spec renders the real
// dialog, so the hook needs a provider stand-in.
vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({ uploadReceipt: vi.fn() }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTransaction(p: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: p.id ?? 'p-1',
    direction: p.direction ?? 'OUT',
    type: 'ONE_TIME',
    amountCents: p.amountCents ?? 1000,
    currency: 'USD',
    occurredAt: '2026-04-25T00:00:00Z',
    status: 'POSTED',
    category: {
      id: 'c-1',
      slug: 'misc',
      name: 'Misc',
      icon: null,
      color: null,
    },
    attributions: p.attributions ?? [
      { scope: 'personal', userId: 'me', groupId: null, groupName: null },
    ],
    note: p.note ?? null,
    commentCount: 0,
    starredByMe: p.starredByMe ?? false,
    hasDocuments: false,
    parentTransactionId: null,
    createdById: 'me',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  };
}

function listResp(
  rows: TransactionSummary[],
  extra?: Partial<{ nextCursor: string | null; hasMore: boolean }>,
) {
  return {
    data: rows,
    nextCursor: extra?.nextCursor ?? null,
    hasMore: extra?.hasMore ?? false,
  };
}

describe('TransactionsList', () => {
  beforeEach(() => {
    mockFetchList.mockReset();
    mockGetTransaction.mockReset();
    mockRemoveTransaction.mockReset();
    mockToggleStar.mockReset();
    mockListCategories.mockReset();
    mockListCategories.mockResolvedValue([]);
    mockCreateTransaction.mockReset();
    mockUpdateTransaction.mockReset();
    mockRouterPush.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('first render fetches with default filters and displays rows', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction()]));
    render(<TransactionsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    expect(mockFetchList).toHaveBeenCalledTimes(1);
    const params = mockFetchList.mock.calls[0][0];
    expect(params.sort).toBe('date_desc');
    expect(params.scope).toBeUndefined(); // 'all' → undefined to API
    expect(params.cursor).toBeUndefined();
  });

  it('renders the loading state during the first fetch', async () => {
    let resolveFn!: (v: unknown) => void;
    mockFetchList.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );
    render(<TransactionsList showFilters={false} />);
    expect(screen.getByTestId('transactions-list-loading')).toBeInTheDocument();
    await act(async () => {
      resolveFn!(listResp([]));
    });
  });

  it('error state with retry button refetches', async () => {
    mockFetchList.mockRejectedValueOnce(new Error('Boom'));
    render(<TransactionsList showFilters={false} />);
    await waitFor(() =>
      expect(screen.getByTestId('transactions-list-error')).toHaveTextContent('Boom'),
    );
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction()]));
    fireEvent.click(screen.getByTestId('transactions-list-retry'));
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    expect(mockFetchList).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state when zero rows are returned', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<TransactionsList showFilters={false} />);
    await waitFor(() => expect(screen.getByTestId('transactions-list-empty')).toBeInTheDocument());
  });

  it('"Load more" appends rows and sends the cursor on the next call', async () => {
    mockFetchList.mockResolvedValueOnce(
      listResp([makeTransaction({ id: 'p-1' })], {
        nextCursor: 'CUR1',
        hasMore: true,
      }),
    );
    render(<TransactionsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    mockFetchList.mockResolvedValueOnce(
      listResp([makeTransaction({ id: 'p-2' })], {
        nextCursor: null,
        hasMore: false,
      }),
    );
    fireEvent.click(screen.getByTestId('transactions-list-load-more'));
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-2')).toBeInTheDocument());
    expect(mockFetchList.mock.calls[0][0].cursor).toBeUndefined();
    expect(mockFetchList.mock.calls[1][0].cursor).toBe('CUR1');
    expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument();
  });

  it('changing a filter triggers a reset refetch (cursor cleared)', async () => {
    mockFetchList.mockResolvedValueOnce(
      listResp([makeTransaction({ id: 'p-1' })], {
        nextCursor: 'CUR1',
        hasMore: true,
      }),
    );
    render(<TransactionsList />);
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    mockFetchList.mockResolvedValueOnce(
      listResp([makeTransaction({ id: 'p-9' })], {
        nextCursor: null,
        hasMore: false,
      }),
    );
    fireEvent.click(screen.getByTestId('filter-direction-out'));
    await waitFor(() => {
      expect(mockFetchList.mock.calls.length).toBe(2);
    });
    expect(mockFetchList.mock.calls[1][0].direction).toBe('OUT');
    expect(mockFetchList.mock.calls[1][0].cursor).toBeUndefined();
  });

  it('with filters.starred=true, unstarring a row optimistically removes it', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction({ starredByMe: true })]));
    mockToggleStar.mockResolvedValueOnce({ starred: false, starCount: 0 });
    render(
      <TransactionsList showFilters={false} filters={{ ...defaultFilters(), starred: true }} />,
    );
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('row-star-p-1'));
    await waitFor(() => expect(screen.queryAllByTestId('transaction-row-p-1')).toHaveLength(0));
  });

  // ── Iteration 6.16.1 — controlled-mode regressions ────────────────────────

  it('changing the controlled `filters` prop triggers a re-fetch with the new params (bug #2 regression)', async () => {
    mockFetchList.mockResolvedValue(listResp([]));
    const { rerender } = render(
      <TransactionsList showFilters={false} filters={defaultFilters()} />,
    );
    await waitFor(() => expect(mockFetchList).toHaveBeenCalledTimes(1));
    expect(mockFetchList.mock.calls[0][0].starred).toBeUndefined();

    rerender(
      <TransactionsList showFilters={false} filters={{ ...defaultFilters(), starred: true }} />,
    );
    await waitFor(() => expect(mockFetchList).toHaveBeenCalledTimes(2));
    expect(mockFetchList.mock.calls[1][0].starred).toBe(true);
  });

  it('controlled mode bubbles toolbar changes via onFiltersChange (no internal mutation)', async () => {
    mockFetchList.mockResolvedValue(listResp([]));
    const onFiltersChange = vi.fn();
    render(
      <TransactionsList
        filters={defaultFilters()}
        onFiltersChange={onFiltersChange}
        categories={[]}
      />,
    );
    await waitFor(() => expect(mockFetchList).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('filter-direction-out'));
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange.mock.calls[0][0]).toMatchObject({ direction: 'OUT' });
  });

  it('delete with transactionDeleted=true removes the row from the list', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction()]));
    mockRemoveTransaction.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      transactionDeleted: true,
      transaction: null,
    });
    render(<TransactionsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('row-controls-p-1'));
    fireEvent.click(screen.getByTestId('row-delete-p-1'));
    fireEvent.click(screen.getByTestId('delete-transaction-confirm'));
    await waitFor(() => expect(screen.queryAllByTestId('transaction-row-p-1')).toHaveLength(0));
  });

  it('delete with transactionDeleted=false re-fetches the row via getTransaction and updates in place', async () => {
    const original = makeTransaction({
      note: 'original',
      attributions: [
        { scope: 'personal', userId: 'me', groupId: null, groupName: null },
        {
          scope: 'group',
          userId: null,
          groupId: 'g-1',
          groupName: 'Family',
        },
      ],
    });
    const updated = makeTransaction({
      note: 'updated',
      attributions: original.attributions,
    });
    mockFetchList.mockResolvedValueOnce(listResp([original]));
    mockRemoveTransaction.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      transactionDeleted: false,
      transaction: null,
    });
    mockGetTransaction.mockResolvedValueOnce(updated);

    render(<TransactionsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('row-controls-p-1'));
    fireEvent.click(screen.getByTestId('row-delete-p-1'));
    fireEvent.click(screen.getByTestId('delete-mode-this'));
    fireEvent.click(screen.getByTestId('delete-transaction-confirm'));
    await waitFor(() => expect(mockGetTransaction).toHaveBeenCalledWith('p-1'));
    await waitFor(() =>
      expect(inDesktop().getByTestId('row-note-p-1').getAttribute('title')).toBe('updated'),
    );
  });

  it('showFilters=false hides the filter toolbar', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction()]));
    render(<TransactionsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    expect(screen.queryByTestId('transactions-filters')).not.toBeInTheDocument();
  });

  it('showControls=false hides per-row controls', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction()]));
    render(<TransactionsList showFilters={false} showControls={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    expect(inDesktop().queryByTestId('row-controls-p-1')).not.toBeInTheDocument();
  });

  it('onTransactionClick is invoked with the row id', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction()]));
    const onClick = vi.fn();
    render(<TransactionsList showFilters={false} onTransactionClick={onClick} />);
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('transaction-row-p-1'));
    expect(onClick).toHaveBeenCalledWith('p-1');
  });

  it('lockScope hides the scope dropdown; filters.scope flows to the fetch', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction()]));
    render(<TransactionsList lockScope filters={{ ...defaultFilters(), scope: 'group:g-1' }} />);
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    expect(screen.queryByTestId('filter-scope')).not.toBeInTheDocument();
    expect(mockFetchList.mock.calls[0][0].scope).toBe('group:g-1');
  });

  it('default categories prop forwards a non-undefined value to TransactionsFilters (no auto-fetch)', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<TransactionsList categories={[]} />);
    await waitFor(() => expect(screen.getByTestId('transactions-list-empty')).toBeInTheDocument());
    expect(mockListCategories).not.toHaveBeenCalled();
  });

  // ── Iteration 6.13 — dialog wiring ─────────────────────────────────────────

  it('toolbar shows "Add transaction" button when showControls !== false', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<TransactionsList showFilters={false} categories={[]} />);
    await waitFor(() => expect(screen.getByTestId('transactions-list-empty')).toBeInTheDocument());
    expect(screen.getByTestId('transactions-list-add')).toBeInTheDocument();
  });

  it('Add transaction button is hidden when showControls=false', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<TransactionsList showFilters={false} showControls={false} categories={[]} />);
    await waitFor(() => expect(screen.getByTestId('transactions-list-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('transactions-list-add')).not.toBeInTheDocument();
  });

  it('disableInternalAdd hides the toolbar Add transaction button', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<TransactionsList showFilters={false} disableInternalAdd categories={[]} />);
    await waitFor(() => expect(screen.getByTestId('transactions-list-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('transactions-list-add')).not.toBeInTheDocument();
  });

  it('clicking Add transaction opens the form dialog in create mode', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<TransactionsList showFilters={false} categories={[]} />);
    await waitFor(() => expect(screen.getByTestId('transactions-list-empty')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('transactions-list-add'));
    expect(screen.getByTestId('transaction-form-dialog')).toBeInTheDocument();
  });

  it('clicking row Edit opens the form dialog in edit mode', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction()]));
    render(<TransactionsList showFilters={false} categories={[]} />);
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('row-controls-p-1'));
    fireEvent.click(screen.getByTestId('row-edit-p-1'));
    expect(screen.getByTestId('transaction-form-dialog')).toBeInTheDocument();
  });

  // ── Iteration 6.14 — default row-click handler ───────────────────────────

  it('default onTransactionClick navigates to the detail page via router.push', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction()]));
    render(<TransactionsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('transaction-row-p-1'));
    expect(mockRouterPush).toHaveBeenCalledWith('/transactions/p-1');
  });

  it('explicit onTransactionClick takes precedence over the default router.push', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction()]));
    const handler = vi.fn();
    render(<TransactionsList showFilters={false} onTransactionClick={handler} />);
    await waitFor(() => expect(inDesktop().getByTestId('transaction-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('transaction-row-p-1'));
    expect(handler).toHaveBeenCalledWith('p-1');
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('default router.push navigation path uses the /transactions/:id shape (next-intl adds locale)', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction({ id: 'abc-123' })]));
    render(<TransactionsList showFilters={false} />);
    await waitFor(() =>
      expect(inDesktop().getByTestId('transaction-row-abc-123')).toBeInTheDocument(),
    );
    fireEvent.click(inDesktop().getByTestId('transaction-row-abc-123'));
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    const arg = mockRouterPush.mock.calls[0][0];
    expect(arg).toBe('/transactions/abc-123');
  });

  // ── Phase 6 · 6.18.1.4-hotfix part 2 — gap recovery (resyncToken) ────────

  it('refetches the first page when resyncToken changes (reconnect-after-gap)', async () => {
    mockFetchList.mockResolvedValue(listResp([makeTransaction()]));
    const ctxValue = (resyncToken: number) => ({
      connectionStatus: 'connected' as const,
      resyncToken,
      subscribe: () => () => {},
    });
    const { rerender } = render(
      <RealtimeContext.Provider value={ctxValue(0)}>
        <TransactionsList showFilters={false} />
      </RealtimeContext.Provider>,
    );
    await waitFor(() => expect(mockFetchList).toHaveBeenCalledTimes(1));

    rerender(
      <RealtimeContext.Provider value={ctxValue(1)}>
        <TransactionsList showFilters={false} />
      </RealtimeContext.Provider>,
    );
    await waitFor(() => expect(mockFetchList).toHaveBeenCalledTimes(2));
    // Resync is a reset fetch — first page, no cursor.
    expect(mockFetchList.mock.calls[1][0].cursor).toBeUndefined();
  });

  it('does NOT self-refetch on resyncToken change in orchestrator mode', async () => {
    mockFetchList.mockResolvedValue(listResp([]));
    const ctxValue = (resyncToken: number) => ({
      connectionStatus: 'connected' as const,
      resyncToken,
      subscribe: () => () => {},
    });
    const data = { rows: [makeTransaction()], cursor: null, hasMore: false };
    const { rerender } = render(
      <RealtimeContext.Provider value={ctxValue(0)}>
        <TransactionsList showFilters={false} data={data} />
      </RealtimeContext.Provider>,
    );
    rerender(
      <RealtimeContext.Provider value={ctxValue(1)}>
        <TransactionsList showFilters={false} data={data} />
      </RealtimeContext.Provider>,
    );
    // The orchestrator owns the loader; the list must not fetch on its own.
    expect(mockFetchList).not.toHaveBeenCalled();
  });
});
