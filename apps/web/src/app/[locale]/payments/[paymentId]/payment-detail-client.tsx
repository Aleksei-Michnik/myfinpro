'use client';

// Phase 6 · Iteration 6.14 — client orchestrator for the payment detail page.
//
// Handles:
//   - initial fetch via usePayments().getPayment
//   - loading / 404 / network-error / success states
//   - edit (PaymentFormDialog) + delete (DeletePaymentDialog) mounts
//   - star-toggle bubble-up + comment-append bridging

import { isPlanKind } from '@myfinpro/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DeletePaymentDialog } from '@/components/payment/DeletePaymentDialog';
import { PaymentCommentInput } from '@/components/payment/PaymentCommentInput';
import {
  PaymentCommentList,
  type PaymentCommentListHandle,
} from '@/components/payment/PaymentCommentList';
import { PaymentDetailHeader } from '@/components/payment/PaymentDetailHeader';
import { PaymentDocumentsPlaceholder } from '@/components/payment/PaymentDocumentsPlaceholder';
import { PaymentFormDialog } from '@/components/payment/PaymentFormDialog';
import { PaymentPlanSection } from '@/components/payment/PaymentPlanSection';
import { PaymentSchedulePlanPlaceholder } from '@/components/payment/PaymentSchedulePlanPlaceholder';
import { RecurringOccurrencesSection } from '@/components/payment/RecurringOccurrencesSection';
import { ScheduleBadge } from '@/components/payment/ScheduleBadge';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { Link, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { usePayments } from '@/lib/payment/payment-context';
import type {
  AttributionChangeResult,
  PaymentSummary,
  ScheduleResponse,
} from '@/lib/payment/types';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';
import { useAsyncOperation, useResetOnLocaleChange } from '@/lib/ui';

interface PaymentDetailClientProps {
  paymentId: string;
}

interface LoadError {
  status?: number;
  message: string;
}

export function PaymentDetailClient({ paymentId }: PaymentDetailClientProps) {
  const t = useTranslations('payments');
  const tDetail = useTranslations('payments.detail');
  const tComments = useTranslations('payments.comments');
  const tBadge = useTranslations('payments.schedule.badge');
  const locale = useLocale();
  const { getPayment, getSchedule, pauseSchedule, resumeSchedule, cancelSchedule } = usePayments();
  const { addToast } = useToast();
  const { user } = useAuth();
  const router = useRouter();

  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<PaymentSummary | null>(null);

  // Container-scope async op for the schedule fetch — separate from the
  // payment fetch so loading/error states stay independent.
  const scheduleOp = useAsyncOperation<ScheduleResponse | null>({ scope: 'container' });

  const commentListRef = useRef<PaymentCommentListHandle | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await getPayment(paymentId);
      setPayment(p);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      setError({ status: err.status, message: err.message || 'Failed to load payment' });
      setPayment(null);
    } finally {
      setLoading(false);
    }
  }, [getPayment, paymentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fetch the schedule whenever the payment is RECURRING. 404 → null.
  useEffect(() => {
    if (!payment || payment.type !== 'RECURRING' || payment.parentPaymentId !== null) {
      setSchedule(null);
      return;
    }
    void scheduleOp
      .run(async (signal) => getSchedule(payment.id, signal))
      .then((s) => {
        if (s !== undefined) setSchedule(s);
      });
    // scheduleOp identity is stable; including it would re-fire continuously.
  }, [payment?.id, payment?.type, payment?.parentPaymentId]);

  // Phase 6 · Iteration 6.16.5 — clear stale errors when the locale flips
  // (en ↔ he) and re-fetch quietly so we don't briefly flash a "no access"
  // error from the previous render.
  useResetOnLocaleChange(() => {
    void load();
  });

  // Phase 6 · 6.18.1.4-hotfix (part 2) — gap recovery. Refetch the payment
  // (and, transitively via the schedule effect, its schedule) on every
  // realtime reconnect-after-gap. A 404 inside `load()` already becomes
  // an error state with a friendly "not found" branch — no extra wiring
  // needed here.
  useRealtimeResync(() => {
    void load();
  });

  // Realtime: keep the displayed payment in sync with server-side edits and
  // react to deletions by sending the user back to the dashboard.
  useRealtimeEvents({ type: 'payment.updated' }, (event) => {
    if (event.payment.id !== paymentId) return;
    setPayment(event.payment);
  });

  useRealtimeEvents({ type: 'payment.deleted', paymentId }, () => {
    addToast('success', tDetail('deletedToast'));
    router.replace('/dashboard');
  });

  useRealtimeEvents({ type: 'payment_attribution.removed', paymentId }, () => {
    // We may have lost visibility — refetch to confirm; if 404, redirect.
    void getPayment(paymentId)
      .then((fresh) => setPayment(fresh))
      .catch(() => {
        addToast('success', tDetail('deletedToast'));
        router.replace('/dashboard');
      });
  });

  // Phase 6 · Iteration 6.18.1.4.3 — schedule lifecycle echo. The badge is
  // purely presentational, so subscriptions live here and update the
  // `schedule` state that flows down as a prop. All five non-delete events
  // carry the latest `ScheduleResponseDto`, so we just replace the state.
  useRealtimeEvents({ type: 'schedule.created', paymentId }, (event) => {
    setSchedule(event.schedule);
  });
  useRealtimeEvents({ type: 'schedule.updated', paymentId }, (event) => {
    setSchedule(event.schedule);
  });
  useRealtimeEvents({ type: 'schedule.paused', paymentId }, (event) => {
    setSchedule(event.schedule);
  });
  useRealtimeEvents({ type: 'schedule.resumed', paymentId }, (event) => {
    setSchedule(event.schedule);
  });
  useRealtimeEvents({ type: 'schedule.cancelled', paymentId }, (event) => {
    setSchedule(event.schedule);
  });
  useRealtimeEvents({ type: 'schedule.deleted', paymentId }, () => {
    setSchedule(null);
  });

  // Phase 6 · Iteration 6.18.2 — schedule lifecycle actions. Control-scope
  // op so the badge buttons disable while a request is in flight. The
  // response is authoritative and replaces the schedule state directly;
  // the realtime echo (6.18.1.4.3) is belt-and-braces for other tabs.
  const lifecycleOp = useAsyncOperation<ScheduleResponse>({ scope: 'control' });
  const runLifecycle = useCallback(
    (action: 'pause' | 'resume' | 'cancel') => {
      if (!payment) return;
      const call =
        action === 'pause' ? pauseSchedule : action === 'resume' ? resumeSchedule : cancelSchedule;
      void lifecycleOp
        .run((signal) => call(payment.id, signal))
        .then((s) => {
          if (s === undefined) return; // error or abort — surfaced below
          setSchedule(s);
          addToast(
            'success',
            action === 'pause'
              ? tBadge('pausedToast')
              : action === 'resume'
                ? tBadge('resumedToast')
                : tBadge('cancelledToast'),
          );
        });
    },
    // lifecycleOp identity is stable (useAsyncOperation contract).
    [payment?.id, pauseSchedule, resumeSchedule, cancelSchedule, addToast, tBadge],
  );

  // Lifecycle failures (e.g. 409 when another tab already paused/cancelled)
  // surface as an error toast; the realtime echo brings the true state.
  // Aborts (dialog closed / route change) are user-initiated — no toast.
  useEffect(() => {
    if (lifecycleOp.error && lifecycleOp.error.reason !== 'aborted') {
      addToast('error', lifecycleOp.error.message || tBadge('actionFailed'));
    }
  }, [lifecycleOp.error, addToast, tBadge]);

  const handleStarToggled = useCallback((starred: boolean) => {
    setPayment((prev) => (prev ? { ...prev, starredByMe: starred } : prev));
  }, []);

  const handleEditSaved = useCallback(
    async (saved: PaymentSummary | null) => {
      if (saved) {
        setPayment(saved);
      } else {
        // Edit dropped all accessible attributions → payment gone for us.
        addToast('success', tDetail('deletedToast'));
        router.replace('/dashboard');
      }
    },
    [addToast, router, tDetail],
  );

  const handleDeleted = useCallback(
    async (result: AttributionChangeResult) => {
      if (result.paymentDeleted) {
        addToast('success', tDetail('deletedToast'));
        router.replace('/dashboard');
        return;
      }
      // Still visible for someone (we may still have access to another scope) —
      // re-fetch to refresh attributions. If we lost access, treat as gone.
      try {
        const fresh = await getPayment(paymentId);
        setPayment(fresh);
      } catch {
        addToast('success', tDetail('deletedToast'));
        router.replace('/dashboard');
      }
    },
    [addToast, getPayment, paymentId, router, tDetail],
  );

  // ── Render branches ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-8">
        <div
          className="flex items-center justify-center py-16"
          data-testid="payment-detail-loading"
          role="status"
          aria-label={tDetail('loading')}
        >
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          <span className="sr-only">{tDetail('loading')}</span>
        </div>
      </main>
    );
  }

  if (error || !payment) {
    const notFound = !!error && (error.status === 404 || error.status === 403);
    return (
      <main className="container mx-auto max-w-lg px-4 py-8">
        <div
          className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
          data-testid="payment-detail-error"
          role="alert"
        >
          <h1
            className="mb-3 text-xl font-semibold text-gray-900 dark:text-gray-100"
            data-testid="payment-detail-error-title"
          >
            {notFound
              ? tDetail('notFound')
              : tDetail('errorGeneric', { message: error?.message || '' })}
          </h1>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              data-testid="payment-detail-back-dashboard"
            >
              {tDetail('back')}
            </Link>
            {!notFound && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => void load()}
                data-testid="payment-detail-retry"
              >
                {tDetail('tryAgain')}
              </Button>
            )}
          </div>
        </div>
      </main>
    );
  }

  // 6.18.1: RECURRING parents render the live `<ScheduleBadge>`; 6.20: plan
  // parents (INSTALLMENT / LOAN / MORTGAGE) render `<PaymentPlanSection>`.
  // The legacy "schedule/plan placeholder" stays only for LIMITED_PERIOD
  // and for child occurrences.
  const isRecurringParent = payment.type === 'RECURRING' && payment.parentPaymentId === null;
  const isPlanParent = isPlanKind(payment.type) && payment.parentPaymentId === null;
  const isChildOccurrence = payment.parentPaymentId !== null;
  const showLegacyPlaceholder =
    !isRecurringParent &&
    !isPlanParent &&
    (isChildOccurrence || (payment.type !== 'ONE_TIME' && payment.type !== 'RECURRING'));

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/dashboard"
          className="text-sm text-primary-700 hover:underline dark:text-primary-300"
          data-testid="payment-detail-back"
        >
          ← {tDetail('back')}
        </Link>
        {isChildOccurrence && payment.parentPaymentId && (
          <Link
            href={`/payments/${payment.parentPaymentId}`}
            className="text-sm text-primary-700 hover:underline dark:text-primary-300"
            data-testid="payment-detail-from-recurring"
          >
            {tBadge('fromRecurring')}
          </Link>
        )}
      </div>

      <h1 className="sr-only">{t('detail.amountLabel')}</h1>

      <PaymentDetailHeader
        payment={payment}
        onEditClick={() => setEditOpen(true)}
        onDeleteClick={() => setPaymentToDelete(payment)}
        onStarToggled={handleStarToggled}
      />

      {isRecurringParent && schedule && (
        <ScheduleBadge
          schedule={schedule}
          locale={locale}
          canManage={!!user && user.id === payment.createdById}
          pending={lifecycleOp.isLoading}
          onPause={() => runLifecycle('pause')}
          onResume={() => runLifecycle('resume')}
          onCancel={() => runLifecycle('cancel')}
        />
      )}

      {isRecurringParent && <RecurringOccurrencesSection paymentId={payment.id} />}

      {isPlanParent && (
        <PaymentPlanSection
          paymentId={payment.id}
          createdById={payment.createdById}
          currency={payment.currency}
        />
      )}

      <PaymentDocumentsPlaceholder />

      <section
        className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"
        aria-labelledby="comments-title"
      >
        <h2
          id="comments-title"
          className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {tComments('title')}
        </h2>
        <PaymentCommentList paymentId={payment.id} ref={commentListRef} />
        <div className="mt-4">
          <PaymentCommentInput
            paymentId={payment.id}
            onPosted={(c) => commentListRef.current?.appendComment(c)}
          />
        </div>
      </section>

      {showLegacyPlaceholder && <PaymentSchedulePlanPlaceholder />}

      {editOpen && (
        <PaymentFormDialog
          open
          mode="edit"
          payment={payment}
          existingSchedule={schedule}
          onClose={() => setEditOpen(false)}
          onSaved={handleEditSaved}
        />
      )}

      {paymentToDelete && (
        <DeletePaymentDialog
          payment={paymentToDelete}
          onClose={() => setPaymentToDelete(null)}
          onDeleted={handleDeleted}
        />
      )}
    </main>
  );
}
