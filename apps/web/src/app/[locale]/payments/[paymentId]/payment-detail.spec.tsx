import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentDetailClient } from './payment-detail-client';
import type { PaymentSummary, ScheduleResponse } from '@/lib/payment/types';
import { RealtimeContext } from '@/lib/realtime/realtime-context';
import type { RealtimeEvent } from '@/lib/realtime/realtime-types';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetPayment = vi.fn();
const mockGetSchedule = vi.fn();
const mockListOccurrences = vi.fn();
const mockListComments = vi.fn();
const mockPostComment = vi.fn();
const mockEditComment = vi.fn();
const mockDeleteComment = vi.fn();
const mockToggleStar = vi.fn();
const mockRemovePayment = vi.fn();
const mockUpdatePayment = vi.fn();
const mockCreatePayment = vi.fn();
const mockCreateSchedule = vi.fn();
const mockReplaceSchedule = vi.fn();
const mockListCategories = vi.fn();
const mockPauseSchedule = vi.fn();
const mockResumeSchedule = vi.fn();
const mockCancelSchedule = vi.fn();

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

vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({
    getPayment: mockGetPayment,
    getSchedule: mockGetSchedule,
    listOccurrences: mockListOccurrences,
    listComments: mockListComments,
    postComment: mockPostComment,
    editComment: mockEditComment,
    deleteComment: mockDeleteComment,
    toggleStar: mockToggleStar,
    removePayment: mockRemovePayment,
    updatePayment: mockUpdatePayment,
    createPayment: mockCreatePayment,
    createSchedule: mockCreateSchedule,
    replaceSchedule: mockReplaceSchedule,
    listCategories: mockListCategories,
    pauseSchedule: mockPauseSchedule,
    resumeSchedule: mockResumeSchedule,
    cancelSchedule: mockCancelSchedule,
  }),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePayment(p: Partial<PaymentSummary> = {}): PaymentSummary {
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
    parentPaymentId: null,
    createdById: 'me',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
    ...p,
  };
}

describe('PaymentDetailClient', () => {
  beforeEach(() => {
    mockGetPayment.mockReset();
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
    mockRemovePayment.mockReset();
    mockUpdatePayment.mockReset();
    mockCreatePayment.mockReset();
    mockCreateSchedule.mockReset();
    mockReplaceSchedule.mockReset();
    mockListCategories.mockReset();
    mockListCategories.mockResolvedValue([]);
    mockPauseSchedule.mockReset();
    mockResumeSchedule.mockReset();
    mockCancelSchedule.mockReset();
    mockRouterReplace.mockReset();
    mockRouterPush.mockReset();
    mockAddToast.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the loading spinner while fetching', () => {
    mockGetPayment.mockReturnValueOnce(new Promise(() => {}));
    render(<PaymentDetailClient paymentId="p-1" />);
    expect(screen.getByTestId('payment-detail-loading')).toBeInTheDocument();
  });

  it('renders the 404 error card when the API returns 404', async () => {
    const err = Object.assign(new Error('not found'), { status: 404 });
    mockGetPayment.mockRejectedValueOnce(err);
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-error')).toBeInTheDocument());
    expect(screen.getByTestId('payment-detail-error-title').textContent).toMatch(/notFound/);
    expect(screen.queryByTestId('payment-detail-retry')).not.toBeInTheDocument();
  });

  it('generic error card offers Try again', async () => {
    const err = Object.assign(new Error('network'), { status: 500 });
    mockGetPayment.mockRejectedValueOnce(err);
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-error')).toBeInTheDocument());
    mockGetPayment.mockResolvedValueOnce(makePayment());
    fireEvent.click(screen.getByTestId('payment-detail-retry'));
    await waitFor(() => expect(screen.getByTestId('payment-detail-header')).toBeInTheDocument());
  });

  it('successful render shows header + documents placeholder + comments; no schedule for ONE_TIME', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-header')).toBeInTheDocument());
    expect(screen.getByTestId('payment-documents-placeholder')).toBeInTheDocument();
    expect(screen.getByTestId('payment-comment-list')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-schedule-plan-placeholder')).not.toBeInTheDocument();
  });

  it('edit button opens the <PaymentFormDialog>', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-header')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detail-edit'));
    expect(screen.getByTestId('payment-form-dialog')).toBeInTheDocument();
  });

  it('delete button opens the <DeletePaymentDialog>', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-header')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detail-delete'));
    expect(screen.getByTestId('delete-payment-dialog')).toBeInTheDocument();
  });

  it('delete with paymentDeleted=true redirects to /dashboard with toast', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-header')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('detail-delete'));
    mockRemovePayment.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      paymentDeleted: true,
      payment: null,
    });
    fireEvent.click(screen.getByTestId('delete-payment-confirm'));
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/dashboard'));
    expect(mockAddToast).toHaveBeenCalledWith('success', expect.any(String));
  });

  it('delete with paymentDeleted=false re-fetches and keeps the page visible', async () => {
    const first = makePayment({ note: 'one' });
    const second = makePayment({ note: 'two' });
    mockGetPayment.mockResolvedValueOnce(first);
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-note')).toHaveTextContent('one'));
    fireEvent.click(screen.getByTestId('detail-delete'));
    mockRemovePayment.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      paymentDeleted: false,
      payment: null,
    });
    mockGetPayment.mockResolvedValueOnce(second);
    fireEvent.click(screen.getByTestId('delete-payment-confirm'));
    await waitFor(() => expect(screen.getByTestId('detail-note')).toHaveTextContent('two'));
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('star toggle in header updates state', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    mockToggleStar.mockResolvedValueOnce({ starred: true, starCount: 1 });
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-star')).toBeInTheDocument());
    const btn = screen.getByTestId('detail-star');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(mockToggleStar).toHaveBeenCalledWith('p-1', expect.any(AbortSignal)),
    );
  });

  it('new comment posted via input appears at the bottom of the list', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-comment-list')).toBeInTheDocument());
    mockPostComment.mockResolvedValueOnce({
      id: 'c-new',
      paymentId: 'p-1',
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

  it('schedule/plan placeholder is shown when payment has a parentPaymentId', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment({ parentPaymentId: 'parent-1' }));
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('payment-schedule-plan-placeholder')).toBeInTheDocument(),
    );
  });

  it('schedule/plan placeholder is shown for still-unsupported types (INSTALLMENT)', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'INSTALLMENT' }));
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('payment-schedule-plan-placeholder')).toBeInTheDocument(),
    );
  });

  it('RECURRING parent renders <ScheduleBadge> with the fetched schedule', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'RECURRING' }));
    mockGetSchedule.mockResolvedValueOnce({
      id: 's-1',
      paymentId: 'p-1',
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
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('schedule-badge')).toBeInTheDocument());
    expect(screen.queryByTestId('payment-schedule-plan-placeholder')).not.toBeInTheDocument();
    expect(mockGetSchedule).toHaveBeenCalledWith('p-1', expect.any(AbortSignal));
  });

  it('child occurrence renders the "from recurring payment" back-link', async () => {
    mockGetPayment.mockResolvedValueOnce(
      makePayment({ id: 'child-1', parentPaymentId: 'parent-1' }),
    );
    render(<PaymentDetailClient paymentId="child-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('payment-detail-from-recurring')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('payment-detail-from-recurring').getAttribute('href')).toBe(
      '/payments/parent-1',
    );
  });

  it('back link points to /dashboard', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-back')).toBeInTheDocument());
    expect(screen.getByTestId('payment-detail-back').getAttribute('href')).toBe('/dashboard');
  });

  // ── Phase 6 · Iteration 6.18.1.2 — Edit/Delete eligibility regressions ──

  it('Edit button is enabled for RECURRING parent payments', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'RECURRING' }));
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-edit')).toBeInTheDocument());
    expect(screen.getByTestId('detail-edit')).not.toBeDisabled();
  });

  it('Edit button is disabled for child occurrences with the right tooltip', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment({ parentPaymentId: 'parent-1' }));
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-edit')).toBeInTheDocument());
    const btn = screen.getByTestId('detail-edit');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/editDisabled\.generatedOccurrence/);
  });

  it('Edit button is disabled for unsupported types (INSTALLMENT) with the right tooltip', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'INSTALLMENT' }));
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-edit')).toBeInTheDocument());
    const btn = screen.getByTestId('detail-edit');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/editDisabled\.unsupportedType/);
  });

  it('Delete button follows the same eligibility rules', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment({ parentPaymentId: 'parent-1' }));
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-delete')).toBeInTheDocument());
    expect(screen.getByTestId('detail-delete')).toBeDisabled();
  });

  it('Date row displays the time-of-day component', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment());
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('detail-date')).toBeInTheDocument());
    expect(screen.getByTestId('detail-date').textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  // ── Phase 6 · Iteration 6.18.1.3 — <RecurringOccurrencesSection> mount rules ──

  it('RECURRING parent renders the <RecurringOccurrencesSection>', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'RECURRING' }));
    render(<PaymentDetailClient paymentId="p-1" />);
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
    mockGetPayment.mockResolvedValueOnce(
      makePayment({ type: 'RECURRING', parentPaymentId: 'parent-1' }),
    );
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-header')).toBeInTheDocument());
    expect(screen.queryByTestId('recurring-occurrences-section')).not.toBeInTheDocument();
  });

  it('ONE_TIME payment does NOT render the section', async () => {
    mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'ONE_TIME' }));
    render(<PaymentDetailClient paymentId="p-1" />);
    await waitFor(() => expect(screen.getByTestId('payment-detail-header')).toBeInTheDocument());
    expect(screen.queryByTestId('recurring-occurrences-section')).not.toBeInTheDocument();
    expect(mockListOccurrences).not.toHaveBeenCalled();
  });

  // ── Phase 6 · Iteration 6.18.1.4.3 — schedule realtime echo ────────────

  describe('schedule realtime events', () => {
    function makeSchedule(over: Partial<ScheduleResponse> = {}): ScheduleResponse {
      return {
        id: 's-1',
        paymentId: 'p-1',
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
      // PaymentDetailClient registers many `useRealtimeEvents` listeners
      // (payment.*, attribution, schedule.*) — collect them all so emit()
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
          <PaymentDetailClient paymentId="p-1" />
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
      mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'RECURRING' }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(makeSchedule());

      const { emit } = renderWithRealtime();
      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('active'),
      );

      emit({
        type: 'schedule.paused',
        paymentId: 'p-1',
        schedule: makeSchedule({ pausedAt: '2026-05-01T00:00:00Z' }),
      });

      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('paused'),
      );
    });

    it('schedule.resumed → badge re-renders with active state', async () => {
      mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'RECURRING' }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(makeSchedule({ pausedAt: '2026-05-01T00:00:00Z' }));

      const { emit } = renderWithRealtime();
      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('paused'),
      );

      emit({
        type: 'schedule.resumed',
        paymentId: 'p-1',
        schedule: makeSchedule({ pausedAt: null, nextRunAt: '2026-05-02T00:00:00Z' }),
      });

      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('active'),
      );
    });

    it('schedule.cancelled → badge shows cancelled pill', async () => {
      mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'RECURRING' }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(makeSchedule());

      const { emit } = renderWithRealtime();
      await waitFor(() => expect(screen.getByTestId('schedule-badge')).toBeInTheDocument());

      emit({
        type: 'schedule.cancelled',
        paymentId: 'p-1',
        schedule: makeSchedule({ cancelledAt: '2026-05-01T00:00:00Z' }),
      });

      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('cancelled'),
      );
    });

    it('schedule.deleted → badge is removed from the page', async () => {
      mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'RECURRING' }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(makeSchedule());

      const { emit } = renderWithRealtime();
      await waitFor(() => expect(screen.getByTestId('schedule-badge')).toBeInTheDocument());

      emit({ type: 'schedule.deleted', paymentId: 'p-1' });

      await waitFor(() => expect(screen.queryByTestId('schedule-badge')).not.toBeInTheDocument());
    });

    it('schedule.* events for a different payment are ignored', async () => {
      mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'RECURRING' }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(makeSchedule());

      const { emit } = renderWithRealtime();
      await waitFor(() =>
        expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('active'),
      );

      emit({ type: 'schedule.deleted', paymentId: 'p-OTHER' });

      // Badge still present + still active.
      expect(screen.getByTestId('schedule-badge').getAttribute('data-status')).toBe('active');
    });

    it('badge carries aria-live="polite" for screen-reader announcements', async () => {
      mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'RECURRING' }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(makeSchedule());

      render(<PaymentDetailClient paymentId="p-1" />);
      const badge = await screen.findByTestId('schedule-badge');
      expect(badge.getAttribute('aria-live')).toBe('polite');
    });
  });

  // ── Phase 6 · Iteration 6.18.2 — schedule lifecycle actions ────────────

  describe('schedule lifecycle actions (6.18.2)', () => {
    function makeSchedule(over: Partial<ScheduleResponse> = {}): ScheduleResponse {
      return {
        id: 's-1',
        paymentId: 'p-1',
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

    async function renderRecurring(over: Partial<PaymentSummary> = {}, schedule = makeSchedule()) {
      mockGetPayment.mockResolvedValueOnce(makePayment({ type: 'RECURRING', ...over }));
      mockListOccurrences.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
      mockGetSchedule.mockResolvedValueOnce(schedule);
      render(<PaymentDetailClient paymentId="p-1" />);
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
});
