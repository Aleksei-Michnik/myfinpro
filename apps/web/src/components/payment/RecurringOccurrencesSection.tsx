'use client';

// Phase 6 · Iteration 6.18.1.3 — child-occurrence list rendered below the
// <ScheduleBadge> on a RECURRING parent's detail page.
//
// Thin orchestrator: owns the container-scope async op + the cursor /
// rows state, then delegates rendering to the existing reusable
// <PaymentsList> in orchestrator mode (so each row uses the same
// <PaymentRow> component as everywhere else).
//
// Constraints:
//   • No new npm dependency. Collapsibility uses the native
//     <details>/<summary> elements (keyboard-accessible by default).
//   • aria-live="polite" on the count line so AT announces additions.
//   • Initial fetch shows <LoadingOverlay>; in-list "Load more" + retry
//     are owned by <PaymentsList>'s own load-more op.

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PaymentsList, type PaymentsListData } from './PaymentsList';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { usePayments } from '@/lib/payment/payment-context';
import type { PaymentListResponse, PaymentSummary } from '@/lib/payment/types';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useAsyncOperation } from '@/lib/ui';

export interface RecurringOccurrencesSectionProps {
  /** The recurring parent's id. */
  paymentId: string;
}

const PAGE_SIZE = 20;

export function RecurringOccurrencesSection({ paymentId }: RecurringOccurrencesSectionProps) {
  const t = useTranslations('payments.detail.occurrences');

  const { listOccurrences } = usePayments();

  // Container-scope op for the initial fetch (drives <LoadingOverlay>).
  // <PaymentsList> owns its own load-more op, so we don't double-up here.
  const initialOp = useAsyncOperation<PaymentListResponse>({
    scope: 'container',
    id: 'recurring-occurrences-initial',
  });

  const [items, setItems] = useState<PaymentSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const result = await initialOp.run((signal) =>
      listOccurrences(paymentId, { limit: PAGE_SIZE, sort: 'date_desc' }, signal),
    );
    if (!result) return;
    setItems(result.data);
    setCursor(result.nextCursor);
    setHasMore(result.hasMore);
    setLoaded(true);
  }, [initialOp, listOccurrences, paymentId]);

  // The fetch effect depends only on paymentId. Including `load` directly
  // would re-fire continuously because the op identity changes on every
  // render. Same ref pattern as <PaymentsList>'s fetchPageRef.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    void loadRef.current();
  }, [paymentId]);

  const handleAppend = useCallback((next: PaymentsListData) => {
    setItems(next.rows);
    setCursor(next.cursor);
    setHasMore(next.hasMore);
  }, []);

  // Realtime: prepend newly created occurrences for this parent.
  useRealtimeEvents({ type: 'occurrence.created', parentPaymentId: paymentId }, (event) => {
    setItems((prev) =>
      prev.some((r) => r.id === event.payment.id) ? prev : [event.payment, ...prev],
    );
  });

  const data: PaymentsListData = { rows: items, cursor, hasMore };

  // Count line — singular vs plural keys give translators full control
  // over the "1 occurrence" form.
  const count = items.length;
  const countLabel = count === 1 ? t('countSingular') : t('countPlural', { n: String(count) });

  const errorReason = initialOp.error?.reason;
  const showOverlay = initialOp.isLoading && !loaded;
  const showEmpty = loaded && items.length === 0 && !initialOp.isError;

  return (
    <details
      open
      className="relative rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"
      data-testid="recurring-occurrences-section"
    >
      <summary
        className="cursor-pointer list-none text-lg font-semibold text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-100"
        data-testid="recurring-occurrences-summary"
      >
        <span className="me-2 inline-block select-none align-middle text-gray-400" aria-hidden>
          ▾
        </span>
        {t('title')}
      </summary>

      <div className="mt-3 space-y-3">
        <p
          className="text-xs text-gray-500 dark:text-gray-400"
          aria-live="polite"
          data-testid="recurring-occurrences-count"
        >
          {countLabel}
        </p>

        {errorReason && (
          <InlineErrorBanner
            reason={errorReason}
            httpStatus={initialOp.error?.httpStatus}
            onRetry={() => void initialOp.retry()}
            retrying={initialOp.isLoading}
            data-testid="recurring-occurrences-error"
          />
        )}

        {showEmpty ? (
          <p
            className="rounded-md border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400"
            data-testid="recurring-occurrences-empty"
          >
            {t('empty')}
          </p>
        ) : (
          <PaymentsList
            data={data}
            loading={initialOp.isLoading}
            error={errorReason ? (initialOp.error?.message ?? null) : null}
            onAppendData={handleAppend}
            showFilters={false}
            showStar={false}
            showControls={false}
            disableInternalAdd
            limit={PAGE_SIZE}
          />
        )}

        <LoadingOverlay active={showOverlay} data-testid="recurring-occurrences-overlay" />
      </div>
    </details>
  );
}
