import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionDetailClient } from './transaction-detail-client';
import { RealtimeContext } from '@/lib/realtime/realtime-context';
import type { RealtimeEvent } from '@/lib/realtime/realtime-types';
import type { TransactionSummary, ScheduleResponse } from '@/lib/transaction/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetTransaction = vi.fn();
const mockGetSchedule = vi.fn();
const mockListOccurrences = vi.fn();
const mockListComments = vi.fn();
const mockPostComment = vi.fn();
const mockEditComment = vi.fn();
const mockDeleteComment = vi.fn();
const mockToggleStar = vi.fn();
const mockRemoveTransaction = vi.fn();
const mockUpdateTransaction = vi.fn();
const mockCreateTransaction = vi.fn();
const mockCreateSchedule = vi.fn();
const mockReplaceSchedule = vi.fn();
const mockListCategories = vi.fn();
const mockPauseSchedule = vi.fn();
const mockResumeSchedule = vi.fn();
const mockCancelSchedule = vi.fn();
const mockGetPlan = vi.fn();
const mockCancelPlan = vi.fn();
const mockGetReceipt = vi.fn();

const mockRouterReplace = vi.fn();
const mockRouterPush = vi.fn();
const mockAddToast = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (!values) return key;
    if ('message' in values) return `${key}:${values.message}`;
    if ('when' in values) return `${key}:${values.when}`;
    if ('n' in values) return `${key}:${values.n}`;
    if ('expr' in values) return `${key}:${values.expr}`;
    return key;
  },
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: mockRouterPush }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', defaultCurrency: 'USD' } }),
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({ groups: [] }),
}));

vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({
    getTransaction: mockGetTransaction,
    getSchedule: mockGetSchedule,
    listOccurrences: mockListOccurrences,
    listComments: mockListComments,
    postComment: mockPostComment,
    editComment: mockEditComment,
    deleteComment: mockDeleteComment,
    toggleStar: mockToggleStar,
    removeTransaction: mockRemoveTransaction,
    updateTransaction: mockUpdateTransaction,
    createTransaction: mockCreateTransaction,
    createSchedule: mockCreateSchedule,
    replaceSchedule: mockReplaceSchedule,
    listCategories: mockListCategories,
    pauseSchedule: mockPauseSchedule,
    resumeSchedule: mockResumeSchedule,
    cancelSchedule: mockCancelSchedule,
    getPlan: mockGetPlan,
    cancelPlan: mockCancelPlan,
  }),
}));

// The edit dialog offers receipt intake in create mode (7.13); the detail
// page renders the real dialog, so the hook needs a provider stand-in. The
// purchase-details fold (8.18) reads getReceipt from the same hook.
vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({ uploadReceipt: vi.fn(), getReceipt: mockGetReceipt }),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeTransaction(p: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: 'p-1',
    direction: 'OUT',
    type: 'ONE_TIME',
    amountCents: 1234,
    currency: 'USD',
    occurredAt: '2026-04-25T00:00:00Z',
    status: 'POSTED',
    category: { id: 'c-1', slug: 'misc', name: 'Misc', icon: null, color: null },
    attributions: [{ scope: 'personal', userId: 'me', groupId: null, groupName: null }],
    note: null,
    commentCount: 0,
    starredByMe: false,
    hasDocuments: false,
    parentTransactionId: null,
    createdById: 'me',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
    ...p,
  };
}

describe('TransactionDetailClient', () => {
  beforeEach(() => {
    mockGetTransaction.mockReset();
    mockGetSchedule.mockReset();
    mockGetSchedule.mockResolvedValue(null);
    mockListOccurrences.mockReset();
    mockListOccurrences.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    mockListComments.mockReset();
    mockListComments.mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    mockPostComment.mockReset();
    mockEditComment.mockReset();
    mockDeleteComment.mockReset();
    mockToggleStar.mockReset();
    mockRemoveTransaction.mockReset();
    mockUpdateTransaction.mockReset();
    mockCreateTransaction.mockReset();
    mockCreateSchedule.mockReset();
    mockReplaceSchedule.mockReset();
    mockListCategories.mockReset();
    mockListCategories.mockResolvedValue([]);
    mockPauseSchedule.mockReset();
    mockResumeSchedule.mockReset();
    mockCancelSchedule.mockReset();
    mockGetPlan.mockReset();
    mockGetPlan.mockResolvedValue(null);
    mockCancelPlan.mockReset();
    mockGetReceipt.mockReset();
    mockRouterReplace.mockReset();
    mockRouterPush.mockReset();
    mockAddToast.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the loading spinner while fetching', () => {
    mockGetTransaction.mockReturnValueOnce(new Promise(() => {}));
    render(<TransactionDetailClient transactionId="p-1" />);
    expect(screen.getByTestId('transaction-detail-loading')).toBeInTheDocument();
  });

  it('renders the 404 error card when the API returns 404', async () => {
    const err = Object.assign(new Error('not found'), { status: 404 });
    mockGetTransaction.mockRejectedValueOnce(err);
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('transaction-detail-error')).toBeInTheDocument());
    expect(screen.getByTestId('transaction-detail-error-title').textContent).toMatch(/notFound/);
    expect(screen.queryByTestId('transaction-detail-retry')).not.toBeInTheDocument();
  });

  it('generic error card offers Try again', async () => {
    const err = Object.assign(new Error('network'), { status: 500 });
    mockGetTransaction.mockRejectedValueOnce(err);
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('transaction-detail-error')).toBeInTheDocument());
    mockGetTransaction.mockResolvedValueOnce(makeTransaction());
    fireEvent.click(screen.getByTestId('transaction-detail-retry'));
    await waitFor(() =>
      expect(screen.getByTestId('transaction-detail-header')).toBeInTheDocument(),
    );
  });

  it('successful render shows header + comments; no receipt sections without a linked receipt', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction());
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('transaction-detail-header')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('transaction-comment-list')).toBeInTheDocument();
    expect(screen.queryByTestId('transaction-schedule-plan-placeholder')).not.toBeInTheDocument();
    // No linked receipt → neither the purchase-details fold nor the documents panel.
    expect(screen.queryByTestId('transaction-purchase-details')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transaction-documents')).not.toBeInTheDocument();
  });

  it('shows the purchase-details fold + documents panel for a linked receipt (7.13 / 8.18 / 8.19)', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction({ receiptId: 'r-42' }));
    // Resolved (not Once) — the documents panel fetches eagerly and the fold
    // fetches on expand; both read the same receipt.
    mockGetReceipt.mockResolvedValue({
      id: 'r-42',
      source: 'upload',
      files: [{ id: 'f-1', position: 1, mimeType: 'image/jpeg' }],
      items: [
        {
          id: 'i1',
          position: 1,
          rawName: 'Milk',
          quantity: 1,
          unitPriceCents: null,
          discountCents: 0,
          totalCents: 500,
          categoryId: null,
          productId: null,
          productName: null,
          productBrand: null,
          matchStatus: 'PENDING',
          matchCandidates: [],
        },
      ],
    });
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('transaction-purchase-details')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('transaction-documents')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('purchase-details-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('purchase-details-receipt-link')).toHaveAttribute(
        'href',
        '/receipts/r-42',
      ),
    );
  });

  it('edit button opens the <TransactionFormDialog>', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction());
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('transaction-detail-header')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('detail-edit'));
    expect(screen.getByTestId('transaction-form-dialog')).toBeInTheDocument();
  });

  it('delete button opens the <DeleteTransactionDialog>', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction());
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('transaction-detail-header')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('detail-delete'));
    expect(screen.getByTestId('delete-transaction-dialog')).toBeInTheDocument();
  });

  it('delete with transactionDeleted=true redirects to /dashboard with toast', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction());
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('transaction-detail-header')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('detail-delete'));
    mockRemoveTransaction.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      transactionDeleted: true,
      transaction: null,
    });
    fireEvent.click(screen.getByTestId('delete-transaction-confirm'));
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard'));
    expect(mockAddToast).toHaveBeenCalledWith('success', expect.any(String));
  });

  it('delete with transactionDeleted=false re-fetches and keeps the page visible', async () => {
    const first = makeTransaction({ note: 'one' });
    const second = makeTransaction({ note: 'two' });
    mockGetTransaction.mockResolvedValueOnce(first);
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-note')).toHaveTextContent('one'));
    fireEvent.click(screen.getByTestId('detail-delete'));
    mockRemoveTransaction.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      transactionDeleted: false,
      transaction: null,
    });
    mockGetTransaction.mockResolvedValueOnce(second);
    fireEvent.click(screen.getByTestId('delete-transaction-confirm'));
    await waitFor(() => expect(screen.getByTestId('detail-note')).toHaveTextContent('two'));
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('star toggle in header updates state', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction());
    mockToggleStar.mockResolvedValueOnce({ starred: true, starCount: 1 });
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-star')).toBeInTheDocument());
    const btn = screen.getByTestId('detail-star');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mockToggleStar).toHaveBeenCalledWith('p-1', expect.any(AbortSignal)),
    );
  });

  it('new comment posted via input appears at the bottom of the list', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction());
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('transaction-comment-list')).toBeInTheDocument());
    mockPostComment.mockResolvedValueOnce({
      id: 'c-new',
      transactionId: 'p-1',
      author: { id: 'me', name: 'Me' },
      content: 'hi',
      createdAt: '2026-04-25T00:00:00Z',
      updatedAt: '2026-04-25T00:00:00Z',
      deletedAt: null,
      isMine: true,
    });
    fireEvent.change(screen.getByTestId('comment-input-textarea'), {
      target: { value: 'hi' },
    });
    fireEvent.click(screen.getByTestId('comment-input-submit'));
    await waitFor(() => expect(screen.getByTestId('comment-row-c-new')).toBeInTheDocument());
  });

  it('schedule/plan placeholder is shown when transaction has a parentTransactionId', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction({ parentTransactionId: 'parent-1' }));
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('transaction-schedule-plan-placeholder')).toBeInTheDocument(),
    );
  });

  it('schedule/plan placeholder is shown for still-unsupported types (LIMITED_PERIOD)', async () => {
    // 6.20 made the plan kinds first-class — LIMITED_PERIOD is the only
    // remaining type that falls back to the placeholder.
    mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'LIMITED_PERIOD' }));
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('transaction-schedule-plan-placeholder')).toBeInTheDocument(),
    );
  });

  it('RECURRING parent renders <ScheduleBadge> with the fetched schedule', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'RECURRING' }));
    mockGetSchedule.mockResolvedValueOnce({
      id: 's-1',
      transactionId: 'p-1',
      cron: null,
      everyMs: 86_400_000,
      startsAt: '2026-04-25T00:00:00Z',
      endsAt: null,
      limit: null,
      nextRunAt: '2026-04-26T00:00:00Z',
      lastRunAt: null,
      pausedAt: null,
      cancelledAt: null,
      createdAt: '2026-04-25T00:00:00Z',
      updatedAt: '2026-04-25T00:00:00Z',
    });
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('schedule-badge')).toBeInTheDocument());
    expect(screen.queryByTestId('transaction-schedule-plan-placeholder')).not.toBeInTheDocument();
    expect(mockGetSchedule).toHaveBeenCalledWith('p-1', expect.any(AbortSignal));
  });

  it('child occurrence renders the "from recurring transaction" back-link', async () => {
    mockGetTransaction.mockResolvedValueOnce(
      makeTransaction({ id: 'child-1', parentTransactionId: 'parent-1' }),
    );
    render(<TransactionDetailClient transactionId="child-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('transaction-detail-from-recurring')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('transaction-detail-from-recurring').getAttribute('href')).toBe(
      '/transactions/parent-1',
    );
  });

  it('back link points to /dashboard', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction());
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('transaction-detail-back')).toBeInTheDocument());
    expect(screen.getByTestId('transaction-detail-back').getAttribute('href')).toBe('/dashboard');
  });

  // ── Phase 6 · Iteration 6.18.1.2 — Edit/Delete eligibility regressions ──

  it('Edit button is enabled for RECURRING parent transactions', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'RECURRING' }));
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-edit')).toBeInTheDocument());
    expect(screen.getByTestId('detail-edit')).not.toBeDisabled();
  });

  it('Edit button is disabled for child occurrences with the right tooltip', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction({ parentTransactionId: 'parent-1' }));
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-edit')).toBeInTheDocument());
    const btn = screen.getByTestId('detail-edit');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/editDisabled\.generatedOccurrence/);
  });

  it('Edit button is disabled for unsupported types (INSTALLMENT) with the right tooltip', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'INSTALLMENT' }));
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-edit')).toBeInTheDocument());
    const btn = screen.getByTestId('detail-edit');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/editDisabled\.unsupportedType/);
  });

  it('Delete button follows the same eligibility rules', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction({ parentTransactionId: 'parent-1' }));
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-delete')).toBeInTheDocument());
    expect(screen.getByTestId('detail-delete')).toBeDisabled();
  });

  it('Date row displays the time-of-day component', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction());
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-date')).toBeInTheDocument());
    expect(screen.getByTestId('detail-date').textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  // ── Phase 6 · Iteration 6.18.1.3 — <RecurringOccurrencesSection> mount rules ──

  it('RECURRING parent renders the <RecurringOccurrencesSection>', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'RECURRING' }));
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('recurring-occurrences-section')).toBeInTheDocument(),
    );
    expect(mockListOccurrences).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ limit: 20, sort: 'date_desc' }),
      expect.any(AbortSignal),
    );
  });

  it('RECURRING child occurrence does NOT render the section', async () => {
    mockGetTransaction.mockResolvedValueOnce(
      makeTransaction({ type: 'RECURRING', parentTransactionId: 'parent-1' }),
    );
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('transaction-detail-header')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('recurring-occurrences-section')).not.toBeInTheDocument();
  });

  it('ONE_TIME transaction does NOT render the section', async () => {
    mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'ONE_TIME' }));
    render(<TransactionDetailClient transactionId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('transaction-detail-header')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('recurring-occurrences-section')).not.toBeInTheDocument();
    expect(mockListOccurrences).not.toHaveBeenCalled();
  });

  // ── Phase 6 · Iteration 6.18.1.4.3 — schedule realtime echo ────────────

  describe('schedule realtime events', () => {
    function makeSchedule(over: Partial<ScheduleResponse> = {}): ScheduleResponse {
      return {
        id: 's-1',
        transactionId: 'p-1',
        cron: null,
        everyMs: 86_400_000,
        startsAt: '2026-04-25T00:00:00Z',
        endsAt: null,
        limit: null,
        nextRunAt: '2026-04-26T00:00:00Z',
        lastRunAt: null,
        pausedAt: null,
        cancelledAt: null,
        createdAt: '2026-04-25T00:00:00Z',
        updatedAt: '2026-04-25T00:00:00Z',
        ...over,
      };
    }

    function renderWithRealtime() {
      // TransactionDetailClient registers many `useRealtimeEvents` listeners
      // (transaction.*, attribution, schedule.*) — collect them all so emit()
      // fans out, matching the production EventBus semantics.
      const listeners = new Set<(e: RealtimeEvent) => void>();
      const subscribe = (l: (e: RealtimeEvent) => void) => {
        listeners.add(l);
        return () => {
          listeners.delete(l);
        };
      };
      const utils = render(
        <RealtimeContext.Provider
          value={{ connectionStatus: 'connected', resyncToken: 0, subscribe }}
        >
          <TransactionDetailClient transactionId="p-1" />
        </RealtimeContext.Provider>,
      );
      return {
        ...utils,
        emit: (e: RealtimeEvent) =>
          act(() => {
            listeners.forEach((l) => l(e));
          }),
      };
    }

    it('schedule.paused → badge re-renders with paused state', async () => {
      mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'RECURRING' }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(makeSchedule());

      const { emit } = renderWithRealtime();
      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('active'),
      );

      emit({
        type: 'schedule.paused',
        transactionId: 'p-1',
        schedule: makeSchedule({ pausedAt: '2026-05-01T00:00:00Z' }),
      });

      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('paused'),
      );
    });

    it('schedule.resumed → badge re-renders with active state', async () => {
      mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'RECURRING' }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(makeSchedule({ pausedAt: '2026-05-01T00:00:00Z' }));

      const { emit } = renderWithRealtime();
      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('paused'),
      );

      emit({
        type: 'schedule.resumed',
        transactionId: 'p-1',
        schedule: makeSchedule({ pausedAt: null, nextRunAt: '2026-05-02T00:00:00Z' }),
      });

      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('active'),
      );
    });

    it('schedule.cancelled → badge shows cancelled pill', async () => {
      mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'RECURRING' }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(makeSchedule());

      const { emit } = renderWithRealtime();
      await waitFor(() => expect(screen.getByTestId('schedule-badge')).toBeInTheDocument());

      emit({
        type: 'schedule.cancelled',
        transactionId: 'p-1',
        schedule: makeSchedule({ cancelledAt: '2026-05-01T00:00:00Z' }),
      });

      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('cancelled'),
      );
    });

    it('schedule.deleted → badge is removed from the page', async () => {
      mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'RECURRING' }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(makeSchedule());

      const { emit } = renderWithRealtime();
      await waitFor(() => expect(screen.getByTestId('schedule-badge')).toBeInTheDocument());

      emit({ type: 'schedule.deleted', transactionId: 'p-1' });

      await waitFor(() => expect(screen.queryByTestId('schedule-badge')).not.toBeInTheDocument());
    });

    it('schedule.* events for a different transaction are ignored', async () => {
      mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'RECURRING' }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(makeSchedule());

      const { emit } = renderWithRealtime();
      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('active'),
      );

      emit({ type: 'schedule.deleted', transactionId: 'p-OTHER' });

      // Badge still present + still active.
      expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('active');
    });

    it('badge carries aria-live="polite" for screen-reader announcements', async () => {
      mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'RECURRING' }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(makeSchedule());

      render(<TransactionDetailClient transactionId="p-1" />);
      const badge = await screen.findByTestId('schedule-badge');
      expect(badge.getAttribute('aria-live')).toBe('polite');
    });
  });

  // ── Phase 6 · Iteration 6.18.2 — schedule lifecycle actions ────────────

  describe('schedule lifecycle actions (6.18.2)', () => {
    function makeSchedule(over: Partial<ScheduleResponse> = {}): ScheduleResponse {
      return {
        id: 's-1',
        transactionId: 'p-1',
        cron: null,
        everyMs: 86_400_000,
        startsAt: '2026-04-25T00:00:00Z',
        endsAt: null,
        limit: null,
        nextRunAt: '2026-04-26T00:00:00Z',
        lastRunAt: null,
        pausedAt: null,
        cancelledAt: null,
        createdAt: '2026-04-25T00:00:00Z',
        updatedAt: '2026-04-25T00:00:00Z',
        ...over,
      };
    }

    async function renderRecurring(
      over: Partial<TransactionSummary> = {},
      schedule = makeSchedule(),
    ) {
      mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'RECURRING', ...over }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(schedule);
      render(<TransactionDetailClient transactionId="p-1" />);
      await waitFor(() => expect(screen.getByTestId('schedule-badge')).toBeInTheDocument());
    }

    it('creator sees the actions row; pause posts and patches the badge', async () => {
      await renderRecurring();
      expect(screen.getByTestId('schedule-actions')).toBeInTheDocument();
      mockPauseSchedule.mockResolvedValueOnce(makeSchedule({ pausedAt: '2026-05-01T00:00:00Z' }));
      fireEvent.click(screen.getByTestId('schedule-action-pause'));
      await waitFor(() => expect(mockPauseSchedule).toHaveBeenCalled());
      expect(mockPauseSchedule.mock.calls[0][0]).toBe('p-1');
      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('paused'),
      );
      expect(mockAddToast).toHaveBeenCalledWith('success', 'pausedToast');
    });

    it('paused schedule offers resume; resume reactivates', async () => {
      await renderRecurring({}, makeSchedule({ pausedAt: '2026-05-01T00:00:00Z' }));
      expect(screen.queryByTestId('schedule-action-pause')).not.toBeInTheDocument();
      mockResumeSchedule.mockResolvedValueOnce(makeSchedule({ pausedAt: null }));
      fireEvent.click(screen.getByTestId('schedule-action-resume'));
      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('active'),
      );
      expect(mockAddToast).toHaveBeenCalledWith('success', 'resumedToast');
    });

    it('cancel requires the inline confirm; confirming cancels terminally', async () => {
      await renderRecurring();
      fireEvent.click(screen.getByTestId('schedule-action-cancel'));
      // First click only reveals the confirm strip — no API call yet.
      expect(mockCancelSchedule).not.toHaveBeenCalled();
      mockCancelSchedule.mockResolvedValueOnce(
        makeSchedule({ cancelledAt: '2026-05-01T00:00:00Z' }),
      );
      fireEvent.click(screen.getByTestId('schedule-cancel-confirm-yes'));
      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('cancelled'),
      );
      // Terminal state → the whole actions row is gone.
      expect(screen.queryByTestId('schedule-actions')).not.toBeInTheDocument();
      expect(mockAddToast).toHaveBeenCalledWith('success', 'cancelledToast');
    });

    it('keep dismisses the confirm strip without cancelling', async () => {
      await renderRecurring();
      fireEvent.click(screen.getByTestId('schedule-action-cancel'));
      fireEvent.click(screen.getByTestId('schedule-cancel-confirm-keep'));
      expect(screen.queryByTestId('schedule-cancel-confirm')).not.toBeInTheDocument();
      expect(mockCancelSchedule).not.toHaveBeenCalled();
      expect(screen.getByTestId('schedule-action-cancel')).toBeInTheDocument();
    });

    it('non-creator sees no actions row', async () => {
      await renderRecurring({ createdById: 'someone-else' });
      expect(screen.queryByTestId('schedule-actions')).not.toBeInTheDocument();
    });

    it('a failed action surfaces an error toast and leaves the badge state', async () => {
      await renderRecurring();
      mockPauseSchedule.mockRejectedValueOnce(new Error('conflict'));
      fireEvent.click(screen.getByTestId('schedule-action-pause'));
      await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('error', expect.any(String)));
      expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('active');
    });
  });

  // ── Phase 6 · Iteration 6.20 — plan section wiring ─────────────────────

  describe('plan parents (6.20)', () => {
    it('INSTALLMENT parent renders the plan section instead of the legacy placeholder', async () => {
      mockGetTransaction.mockResolvedValueOnce(makeTransaction({ type: 'INSTALLMENT' }));
      mockGetPlan.mockResolvedValueOnce({
        id: 'plan-1',
        transactionId: 'p-1',
        kind: 'INSTALLMENT',
        principalCents: 120_000,
        interestRate: 0,
        transactionsCount: 2,
        frequency: 'MONTHLY',
        firstDueAt: '2026-08-01T00:00:00.000Z',
        amortizationMethod: 'equal',
        cancelledAt: null,
        createdAt: '2026-07-04T00:00:00.000Z',
        rows: [
          {
            index: 1,
            dueAt: '2026-08-01T00:00:00.000Z',
            principalCents: 60_000,
            interestCents: 0,
            totalCents: 60_000,
            remainingCents: 60_000,
            occurrenceId: 'occ-1',
            status: 'PENDING',
          },
          {
            index: 2,
            dueAt: '2026-09-01T00:00:00.000Z',
            principalCents: 60_000,
            interestCents: 0,
            totalCents: 60_000,
            remainingCents: 0,
            occurrenceId: 'occ-2',
            status: 'PENDING',
          },
        ],
      });

      render(<TransactionDetailClient transactionId="p-1" />);
      await waitFor(() => expect(screen.getByTestId('plan-section')).toBeInTheDocument());
      expect(mockGetPlan).toHaveBeenCalledWith('p-1', expect.anything());
      expect(screen.getAllByTestId(/^plan-row-\d+$/)).toHaveLength(2);
      // Neither the recurring machinery nor the legacy placeholder mounts.
      expect(screen.queryByTestId('schedule-badge')).not.toBeInTheDocument();
      expect(screen.queryByTestId('schedule-plan-placeholder')).not.toBeInTheDocument();
      expect(mockGetSchedule).not.toHaveBeenCalled();
    });

    it('ONE_TIME transactions never fetch a plan', async () => {
      mockGetTransaction.mockResolvedValueOnce(makeTransaction());
      render(<TransactionDetailClient transactionId="p-1" />);
      await waitFor(() =>
        expect(screen.getByTestId('transaction-detail-header')).toBeInTheDocument(),
      );
      expect(mockGetPlan).not.toHaveBeenCalled();
    });
  });
});
