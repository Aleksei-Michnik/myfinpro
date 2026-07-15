import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TotalsCard } from './TotalsCard';
import type { TransactionSummary } from '@/lib/transaction/types';

const mockFetchList = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en-US',
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (values && typeof values.message === 'string') return `${key}:${values.message}`;
    if (values && typeof values.count === 'number') return `${key}:${values.count}`;
    return key;
  },
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', defaultCurrency: 'USD' } }),
}));

vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({ fetchList: mockFetchList }),
}));

function makeTransaction(p: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: p.id ?? 'p',
    direction: p.direction ?? 'OUT',
    type: 'ONE_TIME',
    amountCents: p.amountCents ?? 1000,
    currency: p.currency ?? 'USD',
    occurredAt: '2026-04-25T00:00:00Z',
    status: 'POSTED',
    category: { id: 'c', slug: 'misc', name: 'Misc', icon: null, color: null },
    attributions: [{ scope: 'personal', userId: 'me', groupId: null, groupName: null }],
    note: null,
    commentCount: 0,
    starredByMe: false,
    hasDocuments: false,
    parentTransactionId: null,
    createdById: 'me',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  };
}

function listResp(rows: TransactionSummary[], hasMore = false) {
  return { data: rows, nextCursor: null, hasMore };
}

describe('TotalsCard', () => {
  beforeEach(() => {
    mockFetchList.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the loading state while fetching', async () => {
    let resolve!: (v: unknown) => void;
    mockFetchList.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<TotalsCard fromIso="2026-05-01T00:00:00Z" toIso="2026-06-01T00:00:00Z" />);
    expect(screen.getByTestId('totals-card-loading')).toBeInTheDocument();
    // Resolve and flush state updates to avoid leaking pending promises into
    // the next test (which would render against an unsettled async tree).
    await act(async () => {
      resolve!(listResp([]));
    });
  });

  it('shows the empty state when zero transactions', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<TotalsCard fromIso="2026-05-01T00:00:00Z" toIso="2026-06-01T00:00:00Z" />);
    await waitFor(() => expect(screen.getByTestId('totals-card-empty')).toBeInTheDocument());
  });

  it('aggregates IN, OUT and Net for a single currency', async () => {
    mockFetchList.mockResolvedValueOnce(
      listResp([
        makeTransaction({ id: 'a', direction: 'IN', amountCents: 5000, currency: 'USD' }),
        makeTransaction({ id: 'b', direction: 'OUT', amountCents: 1500, currency: 'USD' }),
        makeTransaction({ id: 'c', direction: 'OUT', amountCents: 500, currency: 'USD' }),
      ]),
    );
    render(<TotalsCard fromIso="2026-05-01T00:00:00Z" toIso="2026-06-01T00:00:00Z" />);
    await waitFor(() => expect(screen.getByTestId('totals-card-row-USD')).toBeInTheDocument());
    expect(screen.getByTestId('totals-card-in-USD').textContent).toContain('50.00');
    expect(screen.getByTestId('totals-card-out-USD').textContent).toContain('20.00');
    expect(screen.getByTestId('totals-card-net-USD').textContent).toContain('30.00');
  });

  it('renders one row per currency for multi-currency totals', async () => {
    mockFetchList.mockResolvedValueOnce(
      listResp([
        makeTransaction({ id: 'a', direction: 'IN', amountCents: 1000, currency: 'USD' }),
        makeTransaction({ id: 'b', direction: 'OUT', amountCents: 2000, currency: 'EUR' }),
      ]),
    );
    render(<TotalsCard fromIso="2026-05-01T00:00:00Z" toIso="2026-06-01T00:00:00Z" />);
    await waitFor(() => expect(screen.getByTestId('totals-card-row-USD')).toBeInTheDocument());
    expect(screen.getByTestId('totals-card-row-EUR')).toBeInTheDocument();
  });

  it('places the user default currency first; rest alphabetical', async () => {
    mockFetchList.mockResolvedValueOnce(
      listResp([
        makeTransaction({ id: 'a', currency: 'EUR', amountCents: 100 }),
        makeTransaction({ id: 'b', currency: 'GBP', amountCents: 100 }),
        makeTransaction({ id: 'c', currency: 'USD', amountCents: 100 }),
        makeTransaction({ id: 'd', currency: 'AED', amountCents: 100 }),
      ]),
    );
    render(<TotalsCard fromIso="2026-05-01T00:00:00Z" toIso="2026-06-01T00:00:00Z" />);
    await waitFor(() => expect(screen.getByTestId('totals-card-row-USD')).toBeInTheDocument());
    const rows = screen.getByTestId('totals-card-rows').querySelectorAll('li');
    const order = Array.from(rows).map((li) => li.getAttribute('data-testid'));
    expect(order).toEqual([
      'totals-card-row-USD',
      'totals-card-row-AED',
      'totals-card-row-EUR',
      'totals-card-row-GBP',
    ]);
  });

  it('shows the "partial totals" badge when API hasMore=true', async () => {
    mockFetchList.mockResolvedValueOnce(
      listResp([makeTransaction({ amountCents: 100, currency: 'USD' })], true),
    );
    render(<TotalsCard fromIso="2026-05-01T00:00:00Z" toIso="2026-06-01T00:00:00Z" />);
    await waitFor(() => expect(screen.getByTestId('totals-card-partial')).toBeInTheDocument());
  });

  it('shows error state with retry button on failure', async () => {
    mockFetchList.mockRejectedValueOnce(new Error('Boom'));
    render(<TotalsCard fromIso="2026-05-01T00:00:00Z" toIso="2026-06-01T00:00:00Z" />);
    await waitFor(() => expect(screen.getByTestId('totals-card-error')).toHaveTextContent('Boom'));
    expect(screen.getByTestId('totals-card-retry')).toBeInTheDocument();
  });

  it('retry triggers a refetch', async () => {
    mockFetchList.mockRejectedValueOnce(new Error('Boom'));
    render(<TotalsCard fromIso="2026-05-01T00:00:00Z" toIso="2026-06-01T00:00:00Z" />);
    await waitFor(() => expect(screen.getByTestId('totals-card-retry')).toBeInTheDocument());
    mockFetchList.mockResolvedValueOnce(listResp([makeTransaction({ amountCents: 100 })]));
    screen.getByTestId('totals-card-retry').click();
    await waitFor(() => expect(screen.getByTestId('totals-card-row-USD')).toBeInTheDocument());
    expect(mockFetchList).toHaveBeenCalledTimes(2);
  });

  it('transactions prop bypasses the fetch entirely', async () => {
    render(
      <TotalsCard
        fromIso="2026-05-01T00:00:00Z"
        toIso="2026-06-01T00:00:00Z"
        transactions={[makeTransaction({ direction: 'IN', amountCents: 4200, currency: 'USD' })]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('totals-card-row-USD')).toBeInTheDocument());
    expect(mockFetchList).not.toHaveBeenCalled();
    expect(screen.getByTestId('totals-card-in-USD').textContent).toContain('42.00');
  });

  it('passes the from/to range to fetchList', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<TotalsCard fromIso="2026-05-01T00:00:00Z" toIso="2026-06-01T00:00:00Z" />);
    await waitFor(() => expect(mockFetchList).toHaveBeenCalledTimes(1));
    const params = mockFetchList.mock.calls[0][0];
    expect(params.from).toBe('2026-05-01T00:00:00Z');
    expect(params.to).toBe('2026-06-01T00:00:00Z');
    expect(params.limit).toBe(100);
    expect(params.sort).toBe('date_desc');
  });

  it('formats amounts according to the active locale + currency', async () => {
    render(
      <TotalsCard
        fromIso="2026-05-01T00:00:00Z"
        toIso="2026-06-01T00:00:00Z"
        transactions={[
          makeTransaction({ direction: 'OUT', amountCents: 1234, currency: 'USD' }),
          makeTransaction({ direction: 'OUT', amountCents: 999, currency: 'ILS' }),
        ]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('totals-card-row-USD')).toBeInTheDocument());
    expect(screen.getByTestId('totals-card-out-USD').textContent).toMatch(/12\.34/);
    expect(screen.getByTestId('totals-card-out-ILS').textContent).toMatch(/9\.99/);
  });
});
