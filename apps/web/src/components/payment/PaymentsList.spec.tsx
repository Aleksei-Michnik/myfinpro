import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentsList } from './PaymentsList';
import { defaultFilters } from '@/lib/payment/filters';
import type { PaymentSummary } from '@/lib/payment/types';

// jsdom does not apply Tailwind's `hidden md:block` / `md:hidden` responsive
// rules, so both desktop and mobile variants render simultaneously. Always
// scope row queries to the desktop variant in tests to avoid duplicates.
function inDesktop() {
  return within(screen.getByTestId('payments-list-desktop'));
}

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockFetchList = vi.fn();
const mockGetPayment = vi.fn();
const mockRemovePayment = vi.fn();
const mockToggleStar = vi.fn();
const mockListCategories = vi.fn();
const mockCreatePayment = vi.fn();
const mockUpdatePayment = vi.fn();
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

vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({
    fetchList: mockFetchList,
    getPayment: mockGetPayment,
    removePayment: mockRemovePayment,
    toggleStar: mockToggleStar,
    listCategories: mockListCategories,
    createPayment: mockCreatePayment,
    updatePayment: mockUpdatePayment,
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePayment(p: Partial<PaymentSummary> = {}): PaymentSummary {
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
    parentPaymentId: null,
    createdById: 'me',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  };
}

function listResp(
  rows: PaymentSummary[],
  extra?: Partial<{ nextCursor: string | null; hasMore: boolean }>,
) {
  return {
    data: rows,
    nextCursor: extra?.nextCursor ?? null,
    hasMore: extra?.hasMore ?? false,
  };
}

describe('PaymentsList', () => {
  beforeEach(() => {
    mockFetchList.mockReset();
    mockGetPayment.mockReset();
    mockRemovePayment.mockReset();
    mockToggleStar.mockReset();
    mockListCategories.mockReset();
    mockListCategories.mockResolvedValue([]);
    mockCreatePayment.mockReset();
    mockUpdatePayment.mockReset();
    mockRouterPush.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('first render fetches with default filters and displays rows', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makePayment()]));
    render(<PaymentsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
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
    render(<PaymentsList showFilters={false} />);
    expect(screen.getByTestId('payments-list-loading')).toBeInTheDocument();
    await act(async () => {
      resolveFn!(listResp([]));
    });
  });

  it('error state with retry button refetches', async () => {
    mockFetchList.mockRejectedValueOnce(new Error('Boom'));
    render(<PaymentsList showFilters={false} />);
    await waitFor(() =>
      expect(screen.getByTestId('payments-list-error')).toHaveTextContent('Boom'),
    );
    mockFetchList.mockResolvedValueOnce(listResp([makePayment()]));
    fireEvent.click(screen.getByTestId('payments-list-retry'));
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    expect(mockFetchList).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state when zero rows are returned', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<PaymentsList showFilters={false} />);
    await waitFor(() => expect(screen.getByTestId('payments-list-empty')).toBeInTheDocument());
  });

  it('"Load more" appends rows and sends the cursor on the next call', async () => {
    mockFetchList.mockResolvedValueOnce(
      listResp([makePayment({ id: 'p-1' })], {
        nextCursor: 'CUR1',
        hasMore: true,
      }),
    );
    render(<PaymentsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    mockFetchList.mockResolvedValueOnce(
      listResp([makePayment({ id: 'p-2' })], {
        nextCursor: null,
        hasMore: false,
      }),
    );
    fireEvent.click(screen.getByTestId('payments-list-load-more'));
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-2')).toBeInTheDocument());
    expect(mockFetchList.mock.calls[0][0].cursor).toBeUndefined();
    expect(mockFetchList.mock.calls[1][0].cursor).toBe('CUR1');
    expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument();
  });

  it('changing a filter triggers a reset refetch (cursor cleared)', async () => {
    mockFetchList.mockResolvedValueOnce(
      listResp([makePayment({ id: 'p-1' })], {
        nextCursor: 'CUR1',
        hasMore: true,
      }),
    );
    render(<PaymentsList />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    mockFetchList.mockResolvedValueOnce(
      listResp([makePayment({ id: 'p-9' })], {
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
    mockFetchList.mockResolvedValueOnce(listResp([makePayment({ starredByMe: true })]));
    mockToggleStar.mockResolvedValueOnce({ starred: false, starCount: 0 });
    render(<PaymentsList showFilters={false} filters={{ ...defaultFilters(), starred: true }} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('row-star-p-1'));
    await waitFor(() => expect(screen.queryAllByTestId('payment-row-p-1')).toHaveLength(0));
  });

  // ── Iteration 6.16.1 — controlled-mode regressions ────────────────────────

  it('changing the controlled `filters` prop triggers a re-fetch with the new params (bug #2 regression)', async () => {
    mockFetchList.mockResolvedValue(listResp([]));
    const { rerender } = render(<PaymentsList showFilters={false} filters={defaultFilters()} />);
    await waitFor(() => expect(mockFetchList).toHaveBeenCalledTimes(1));
    expect(mockFetchList.mock.calls[0][0].starred).toBeUndefined();

    rerender(<PaymentsList showFilters={false} filters={{ ...defaultFilters(), starred: true }} />);
    await waitFor(() => expect(mockFetchList).toHaveBeenCalledTimes(2));
    expect(mockFetchList.mock.calls[1][0].starred).toBe(true);
  });

  it('controlled mode bubbles toolbar changes via onFiltersChange (no internal mutation)', async () => {
    mockFetchList.mockResolvedValue(listResp([]));
    const onFiltersChange = vi.fn();
    render(
      <PaymentsList filters={defaultFilters()} onFiltersChange={onFiltersChange} categories={[]} />,
    );
    await waitFor(() => expect(mockFetchList).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('filter-direction-out'));
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange.mock.calls[0][0]).toMatchObject({ direction: 'OUT' });
  });

  it('delete with paymentDeleted=true removes the row from the list', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makePayment()]));
    mockRemovePayment.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      paymentDeleted: true,
      payment: null,
    });
    render(<PaymentsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('row-controls-p-1'));
    fireEvent.click(screen.getByTestId('row-delete-p-1'));
    fireEvent.click(screen.getByTestId('delete-payment-confirm'));
    await waitFor(() => expect(screen.queryAllByTestId('payment-row-p-1')).toHaveLength(0));
  });

  it('delete with paymentDeleted=false re-fetches the row via getPayment and updates in place', async () => {
    const original = makePayment({
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
    const updated = makePayment({
      note: 'updated',
      attributions: original.attributions,
    });
    mockFetchList.mockResolvedValueOnce(listResp([original]));
    mockRemovePayment.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      paymentDeleted: false,
      payment: null,
    });
    mockGetPayment.mockResolvedValueOnce(updated);

    render(<PaymentsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('row-controls-p-1'));
    fireEvent.click(screen.getByTestId('row-delete-p-1'));
    fireEvent.click(screen.getByTestId('delete-mode-this'));
    fireEvent.click(screen.getByTestId('delete-payment-confirm'));
    await waitFor(() => expect(mockGetPayment).toHaveBeenCalledWith('p-1'));
    await waitFor(() =>
      expect(inDesktop().getByTestId('row-note-p-1').getAttribute('title')).toBe('updated'),
    );
  });

  it('showFilters=false hides the filter toolbar', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makePayment()]));
    render(<PaymentsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    expect(screen.queryByTestId('payments-filters')).not.toBeInTheDocument();
  });

  it('showControls=false hides per-row controls', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makePayment()]));
    render(<PaymentsList showFilters={false} showControls={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    expect(inDesktop().queryByTestId('row-controls-p-1')).not.toBeInTheDocument();
  });

  it('onPaymentClick is invoked with the row id', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makePayment()]));
    const onClick = vi.fn();
    render(<PaymentsList showFilters={false} onPaymentClick={onClick} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('payment-row-p-1'));
    expect(onClick).toHaveBeenCalledWith('p-1');
  });

  it('lockScope hides the scope dropdown; filters.scope flows to the fetch', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makePayment()]));
    render(<PaymentsList lockScope filters={{ ...defaultFilters(), scope: 'group:g-1' }} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    expect(screen.queryByTestId('filter-scope')).not.toBeInTheDocument();
    expect(mockFetchList.mock.calls[0][0].scope).toBe('group:g-1');
  });

  it('default categories prop forwards a non-undefined value to PaymentsFilters (no auto-fetch)', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<PaymentsList categories={[]} />);
    await waitFor(() => expect(screen.getByTestId('payments-list-empty')).toBeInTheDocument());
    expect(mockListCategories).not.toHaveBeenCalled();
  });

  // ── Iteration 6.13 — dialog wiring ─────────────────────────────────────────

  it('toolbar shows "Add payment" button when showControls !== false', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<PaymentsList showFilters={false} categories={[]} />);
    await waitFor(() => expect(screen.getByTestId('payments-list-empty')).toBeInTheDocument());
    expect(screen.getByTestId('payments-list-add')).toBeInTheDocument();
  });

  it('Add payment button is hidden when showControls=false', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<PaymentsList showFilters={false} showControls={false} categories={[]} />);
    await waitFor(() => expect(screen.getByTestId('payments-list-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('payments-list-add')).not.toBeInTheDocument();
  });

  it('disableInternalAdd hides the toolbar Add payment button', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<PaymentsList showFilters={false} disableInternalAdd categories={[]} />);
    await waitFor(() => expect(screen.getByTestId('payments-list-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('payments-list-add')).not.toBeInTheDocument();
  });

  it('clicking Add payment opens the form dialog in create mode', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([]));
    render(<PaymentsList showFilters={false} categories={[]} />);
    await waitFor(() => expect(screen.getByTestId('payments-list-empty')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('payments-list-add'));
    expect(screen.getByTestId('payment-form-dialog')).toBeInTheDocument();
  });

  it('clicking row Edit opens the form dialog in edit mode', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makePayment()]));
    render(<PaymentsList showFilters={false} categories={[]} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('row-controls-p-1'));
    fireEvent.click(screen.getByTestId('row-edit-p-1'));
    expect(screen.getByTestId('payment-form-dialog')).toBeInTheDocument();
  });

  // ── Iteration 6.14 — default row-click handler ───────────────────────────

  it('default onPaymentClick navigates to the detail page via router.push', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makePayment()]));
    render(<PaymentsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('payment-row-p-1'));
    expect(mockRouterPush).toHaveBeenCalledWith('/payments/p-1');
  });

  it('explicit onPaymentClick takes precedence over the default router.push', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makePayment()]));
    const handler = vi.fn();
    render(<PaymentsList showFilters={false} onPaymentClick={handler} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-p-1')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('payment-row-p-1'));
    expect(handler).toHaveBeenCalledWith('p-1');
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('default router.push navigation path uses the /payments/:id shape (next-intl adds locale)', async () => {
    mockFetchList.mockResolvedValueOnce(listResp([makePayment({ id: 'abc-123' })]));
    render(<PaymentsList showFilters={false} />);
    await waitFor(() => expect(inDesktop().getByTestId('payment-row-abc-123')).toBeInTheDocument());
    fireEvent.click(inDesktop().getByTestId('payment-row-abc-123'));
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    const arg = mockRouterPush.mock.calls[0][0];
    expect(arg).toBe('/payments/abc-123');
  });
});
