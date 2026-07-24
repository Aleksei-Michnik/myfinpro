'use client';

// Phase 6 · Iteration 6.14 — client orchestrator for the transaction detail page.
//
// Handles:
//   - initial fetch via useTransactions().getTransaction
//   - loading / 404 / network-error / success states
//   - edit (TransactionFormDialog) + delete (DeleteTransactionDialog) mounts
//   - star-toggle bubble-up + comment-append bridging

import { isPlanKind } from '@myfinpro/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AttachReceiptDialog } from '@/components/receipt/AttachReceiptDialog';
import { LinkReceiptDialog } from '@/components/receipt/LinkReceiptDialog';
import { DeleteTransactionDialog } from '@/components/transaction/DeleteTransactionDialog';
import { RecurringOccurrencesSection } from '@/components/transaction/RecurringOccurrencesSection';
import { ScheduleBadge } from '@/components/transaction/ScheduleBadge';
import { TransactionCommentInput } from '@/components/transaction/TransactionCommentInput';
import {
  TransactionCommentList,
  type TransactionCommentListHandle,
} from '@/components/transaction/TransactionCommentList';
import { TransactionDetailHeader } from '@/components/transaction/TransactionDetailHeader';
import { TransactionDocuments } from '@/components/transaction/TransactionDocuments';
import { TransactionFormDialog } from '@/components/transaction/TransactionFormDialog';
import { TransactionPlanSection } from '@/components/transaction/TransactionPlanSection';
import { TransactionPurchaseDetails } from '@/components/transaction/TransactionPurchaseDetails';
import { TransactionSchedulePlanPlaceholder } from '@/components/transaction/TransactionSchedulePlanPlaceholder';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { Link, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';
import { useReceipts } from '@/lib/receipt/receipt-context';
import { useTransactions } from '@/lib/transaction/transaction-context';
import type {
  AttributionChangeResult,
  TransactionSummary,
  ScheduleResponse,
} from '@/lib/transaction/types';
import { useAsyncOperation, useResetOnLocaleChange } from '@/lib/ui';

interface TransactionDetailClientProps {
  transactionId: string;
}

interface LoadError {
  status?: number;
  message: string;
}

export function TransactionDetailClient({ transactionId }: TransactionDetailClientProps) {
  const t = useTranslations('transactions');
  const tDetail = useTranslations('transactions.detail');
  const tComments = useTranslations('transactions.comments');
  const tBadge = useTranslations('transactions.schedule.badge');
  const tLink = useTranslations('receipts.link');
  const locale = useLocale();
  const { getTransaction, getSchedule, pauseSchedule, resumeSchedule, cancelSchedule } =
    useTransactions();
  const { unlinkReceipt } = useReceipts();
  const { addToast } = useToast();
  const { user } = useAuth();
  const router = useRouter();

  const [transaction, setTransaction] = useState<TransactionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState<TransactionSummary | null>(null);
  // 8.28 — attach a new receipt, link an existing one, or detach the linked one.
  const [attachOpen, setAttachOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [detachOpen, setDetachOpen] = useState(false);
  const detachOp = useAsyncOperation<boolean>({ scope: 'control' });

  // Container-scope async op for the schedule fetch — separate from the
  // transaction fetch so loading/error states stay independent.
  const scheduleOp = useAsyncOperation<ScheduleResponse | null>({ scope: 'container' });

  const commentListRef = useRef<TransactionCommentListHandle | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await getTransaction(transactionId);
      setTransaction(p);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      setError({ status: err.status, message: err.message || 'Failed to load transaction' });
      setTransaction(null);
    } finally {
      setLoading(false);
    }
  }, [getTransaction, transactionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fetch the schedule whenever the transaction is RECURRING. 404 → null.
  useEffect(() => {
    if (
      !transaction ||
      transaction.type !== 'RECURRING' ||
      transaction.parentTransactionId !== null
    ) {
      setSchedule(null);
      return;
    }
    void scheduleOp
      .run(async (signal) => getSchedule(transaction.id, signal))
      .then((s) => {
        if (s !== undefined) setSchedule(s);
      });
    // scheduleOp identity is stable; including it would re-fire continuously.
  }, [transaction?.id, transaction?.type, transaction?.parentTransactionId]);

  // Phase 6 · Iteration 6.16.5 — clear stale errors when the locale flips
  // (en ↔ he) and re-fetch quietly so we don't briefly flash a "no access"
  // error from the previous render.
  useResetOnLocaleChange(() => {
    void load();
  });

  // Phase 6 · 6.18.1.4-hotfix (part 2) — gap recovery. Refetch the transaction
  // (and, transitively via the schedule effect, its schedule) on every
  // realtime reconnect-after-gap. A 404 inside `load()` already becomes
  // an error state with a friendly "not found" branch — no extra wiring
  // needed here.
  useRealtimeResync(() => {
    void load();
  });

  // Realtime: keep the displayed transaction in sync with server-side edits and
  // react to deletions by sending the user back to the dashboard.
  useRealtimeEvents({ type: 'transaction.updated' }, (event) => {
    if (event.transaction.id !== transactionId) return;
    setTransaction(event.transaction);
  });

  useRealtimeEvents({ type: 'transaction.deleted', transactionId }, () => {
    addToast('success', tDetail('deletedToast'));
    router.replace('/dashboard');
  });

  useRealtimeEvents({ type: 'transaction_attribution.removed', transactionId }, () => {
    // We may have lost visibility — refetch to confirm; if 404, redirect.
    void getTransaction(transactionId)
      .then((fresh) => setTransaction(fresh))
      .catch(() => {
        addToast('success', tDetail('deletedToast'));
        router.replace('/dashboard');
      });
  });

  // Phase 6 · Iteration 6.18.1.4.3 — schedule lifecycle echo. The badge is
  // purely presentational, so subscriptions live here and update the
  // `schedule` state that flows down as a prop. All five non-delete events
  // carry the latest `ScheduleResponseDto`, so we just replace the state.
  useRealtimeEvents({ type: 'schedule.created', transactionId }, (event) => {
    setSchedule(event.schedule);
  });
  useRealtimeEvents({ type: 'schedule.updated', transactionId }, (event) => {
    setSchedule(event.schedule);
  });
  useRealtimeEvents({ type: 'schedule.paused', transactionId }, (event) => {
    setSchedule(event.schedule);
  });
  useRealtimeEvents({ type: 'schedule.resumed', transactionId }, (event) => {
    setSchedule(event.schedule);
  });
  useRealtimeEvents({ type: 'schedule.cancelled', transactionId }, (event) => {
    setSchedule(event.schedule);
  });
  useRealtimeEvents({ type: 'schedule.deleted', transactionId }, () => {
    setSchedule(null);
  });

  // Phase 6 · Iteration 6.18.2 — schedule lifecycle actions. Control-scope
  // op so the badge buttons disable while a request is in flight. The
  // response is authoritative and replaces the schedule state directly;
  // the realtime echo (6.18.1.4.3) is belt-and-braces for other tabs.
  const lifecycleOp = useAsyncOperation<ScheduleResponse>({ scope: 'control' });
  const runLifecycle = useCallback(
    (action: 'pause' | 'resume' | 'cancel') => {
      if (!transaction) return;
      const call =
        action === 'pause' ? pauseSchedule : action === 'resume' ? resumeSchedule : cancelSchedule;
      void lifecycleOp
        .run((signal) => call(transaction.id, signal))
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
    [transaction?.id, pauseSchedule, resumeSchedule, cancelSchedule, addToast, tBadge],
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
    setTransaction((prev) => (prev ? { ...prev, starredByMe: starred } : prev));
  }, []);

  const handleEditSaved = useCallback(
    async (saved: TransactionSummary | null) => {
      if (saved) {
        setTransaction(saved);
      } else {
        // Edit dropped all accessible attributions → transaction gone for us.
        addToast('success', tDetail('deletedToast'));
        router.replace('/dashboard');
      }
    },
    [addToast, router, tDetail],
  );

  const handleDeleted = useCallback(
    async (result: AttributionChangeResult) => {
      if (result.transactionDeleted) {
        addToast('success', tDetail('deletedToast'));
        router.replace('/dashboard');
        return;
      }
      // Still visible for someone (we may still have access to another scope) —
      // re-fetch to refresh attributions. If we lost access, treat as gone.
      try {
        const fresh = await getTransaction(transactionId);
        setTransaction(fresh);
      } catch {
        addToast('success', tDetail('deletedToast'));
        router.replace('/dashboard');
      }
    },
    [addToast, getTransaction, transactionId, router, tDetail],
  );

  // 8.28 — detach the linked receipt (revertible). The receipt uploader is
  // always the transaction creator in every linking flow, so unlink succeeds.
  const handleDetachReceipt = useCallback(() => {
    if (!transaction?.receiptId) return;
    const receiptId = transaction.receiptId;
    setDetachOpen(false);
    void detachOp
      .run(async (signal) => {
        await unlinkReceipt(receiptId, signal);
        return true;
      })
      .then(async (ok) => {
        if (ok === undefined) return;
        addToast('success', tLink('detachedToast'));
        await load();
      });
    // detachOp identity is stable (useAsyncOperation contract).
  }, [transaction?.receiptId, unlinkReceipt, addToast, tLink, load]);

  useEffect(() => {
    if (detachOp.error && detachOp.error.reason !== 'aborted') {
      addToast('error', detachOp.error.message || tLink('failed'));
    }
  }, [detachOp.error, addToast, tLink]);

  // ── Render branches ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-8">
        <div
          className="flex items-center justify-center py-16"
          data-testid="transaction-detail-loading"
          role="status"
          aria-label={tDetail('loading')}
        >
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          <span className="sr-only">{tDetail('loading')}</span>
        </div>
      </main>
    );
  }

  if (error || !transaction) {
    const notFound = !!error && (error.status === 404 || error.status === 403);
    return (
      <main className="container mx-auto max-w-lg px-4 py-8">
        <div
          className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
          data-testid="transaction-detail-error"
          role="alert"
        >
          <h1
            className="mb-3 text-xl font-semibold text-gray-900 dark:text-gray-100"
            data-testid="transaction-detail-error-title"
          >
            {notFound
              ? tDetail('notFound')
              : tDetail('errorGeneric', { message: error?.message || '' })}
          </h1>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              data-testid="transaction-detail-back-dashboard"
            >
              {tDetail('back')}
            </Link>
            {!notFound && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => void load()}
                data-testid="transaction-detail-retry"
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
  // parents (INSTALLMENT / LOAN / MORTGAGE) render `<TransactionPlanSection>`.
  // The legacy "schedule/plan placeholder" stays only for LIMITED_PERIOD
  // and for child occurrences.
  const isRecurringParent =
    transaction.type === 'RECURRING' && transaction.parentTransactionId === null;
  const isPlanParent = isPlanKind(transaction.type) && transaction.parentTransactionId === null;
  const isChildOccurrence = transaction.parentTransactionId !== null;
  // 8.28 — receipt attach/link/detach is a creator-only action on an expense.
  const canManageReceipt =
    !!user && user.id === transaction.createdById && transaction.direction === 'OUT';
  const showLegacyPlaceholder =
    !isRecurringParent &&
    !isPlanParent &&
    (isChildOccurrence || (transaction.type !== 'ONE_TIME' && transaction.type !== 'RECURRING'));

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/dashboard"
          className="text-sm text-primary-700 hover:underline dark:text-primary-300"
          data-testid="transaction-detail-back"
        >
          ← {tDetail('back')}
        </Link>
        {isChildOccurrence && transaction.parentTransactionId && (
          <Link
            href={`/transactions/${transaction.parentTransactionId}`}
            className="text-sm text-primary-700 hover:underline dark:text-primary-300"
            data-testid="transaction-detail-from-recurring"
          >
            {tBadge('fromRecurring')}
          </Link>
        )}
      </div>

      <h1 className="sr-only">{t('detail.amountLabel')}</h1>

      <TransactionDetailHeader
        transaction={transaction}
        onEditClick={() => setEditOpen(true)}
        onDeleteClick={() => setTransactionToDelete(transaction)}
        onStarToggled={handleStarToggled}
      />

      {isRecurringParent && schedule && (
        <ScheduleBadge
          schedule={schedule}
          locale={locale}
          canManage={!!user && user.id === transaction.createdById}
          pending={lifecycleOp.isLoading}
          onPause={() => runLifecycle('pause')}
          onResume={() => runLifecycle('resume')}
          onCancel={() => runLifecycle('cancel')}
        />
      )}

      {isRecurringParent && <RecurringOccurrencesSection transactionId={transaction.id} />}

      {isPlanParent && (
        <TransactionPlanSection
          transactionId={transaction.id}
          createdById={transaction.createdById}
          currency={transaction.currency}
        />
      )}

      {/* 7.13 / 8.18 / 8.19 — the linked receipt is this transaction's proving
          document: its items fold open (purchase details) and its file(s) are
          viewable (documents). Both are visible to any transaction co-viewer.
          8.28 — the creator can detach it (revertible), or, when there is none,
          attach a new receipt / link an existing one. */}
      {transaction.receiptId ? (
        <>
          {canManageReceipt && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setDetachOpen(true)}
                disabled={detachOp.isLoading}
                data-testid="transaction-detach-receipt"
                className="text-sm text-gray-500 hover:text-gray-800 hover:underline disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {tLink('detachReceipt')}
              </button>
            </div>
          )}
          <TransactionPurchaseDetails
            receiptId={transaction.receiptId}
            currency={transaction.currency}
          />
          <TransactionDocuments receiptId={transaction.receiptId} />
        </>
      ) : (
        canManageReceipt && (
          <section
            className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-center dark:border-gray-600 dark:bg-gray-800"
            data-testid="transaction-attach-receipt-cta"
          >
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
              {tDetail('noReceiptHint')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAttachOpen(true)}
              data-testid="transaction-attach-receipt"
            >
              {tDetail('attachReceipt')}
            </Button>
          </section>
        )
      )}

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
        <TransactionCommentList transactionId={transaction.id} ref={commentListRef} />
        <div className="mt-4">
          <TransactionCommentInput
            transactionId={transaction.id}
            onPosted={(c) => commentListRef.current?.appendComment(c)}
          />
        </div>
      </section>

      {showLegacyPlaceholder && <TransactionSchedulePlanPlaceholder />}

      {editOpen && (
        <TransactionFormDialog
          open
          mode="edit"
          transaction={transaction}
          existingSchedule={schedule}
          onClose={() => setEditOpen(false)}
          onSaved={handleEditSaved}
        />
      )}

      {transactionToDelete && (
        <DeleteTransactionDialog
          transaction={transactionToDelete}
          onClose={() => setTransactionToDelete(null)}
          onDeleted={handleDeleted}
        />
      )}

      {/* 8.28 — attach a new receipt (upload/URL) or hand off to the existing-
          receipt picker; a linked REVIEW receipt continues to reconcile. */}
      {attachOpen && (
        <AttachReceiptDialog
          open
          transactionId={transaction.id}
          onClose={() => setAttachOpen(false)}
          onAttached={(receipt) => {
            setAttachOpen(false);
            router.push(`/receipts/${receipt.id}`);
          }}
          onLinkExisting={() => {
            setAttachOpen(false);
            setLinkOpen(true);
          }}
        />
      )}

      {linkOpen && (
        <LinkReceiptDialog
          open
          transactionId={transaction.id}
          locale={locale}
          onClose={() => setLinkOpen(false)}
          onLinked={(receipt) => {
            setLinkOpen(false);
            if (receipt.status === 'REVIEW') {
              router.push(`/receipts/${receipt.id}`);
            } else {
              addToast('success', tLink('linkedToast'));
              void load();
            }
          }}
        />
      )}

      {detachOpen && (
        <ConfirmDialog
          title={tLink('detachTitle')}
          message={tLink('detachMessage')}
          confirmLabel={tLink('detachConfirm')}
          cancelLabel={tLink('detachCancel')}
          busy={detachOp.isLoading}
          onConfirm={handleDetachReceipt}
          onClose={() => setDetachOpen(false)}
        />
      )}
    </main>
  );
}
