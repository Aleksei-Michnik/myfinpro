'use client';

// Phase 6 · Iteration 6.20 — plan section for the payment detail page.
//
// Renders for plan-kind parents (INSTALLMENT / LOAN / MORTGAGE): a summary
// strip (kind, principal, rate, count, method, status) + the amortisation
// table with per-row occurrence status, and a creator-only terminal Cancel
// action behind an inline two-step confirm (mirrors the 6.18.2 schedule
// badge pattern). Owns its own fetch via usePayments().getPlan — the parent
// page only passes ids.

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth/auth-context';
import { usePayments } from '@/lib/payment/payment-context';
import type { PlanResponse } from '@/lib/payment/types';
import { useAsyncOperation } from '@/lib/ui';

export interface PaymentPlanSectionProps {
  paymentId: string;
  /** Creator gating for the cancel action (API is creator-only anyway). */
  createdById: string;
  /** The parent payment's currency — plan rows are amounts in it. */
  currency: string;
}

function formatMoney(cents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d);
}

const ROW_STATUS_CLASSES: Record<string, string> = {
  PENDING:
    'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 border border-blue-200 dark:border-blue-800',
  POSTED:
    'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 border border-green-200 dark:border-green-800',
  DUE: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-200 dark:border-amber-800',
  CANCELLED:
    'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600',
};

export function PaymentPlanSection({ paymentId, createdById, currency }: PaymentPlanSectionProps) {
  const t = useTranslations('payments.plan');
  const locale = useLocale();
  const { user } = useAuth();
  const { getPlan, cancelPlan } = usePayments();
  const { addToast } = useToast();

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const loadOp = useAsyncOperation<PlanResponse | null>({ scope: 'container' });
  const cancelOp = useAsyncOperation<PlanResponse>({ scope: 'control' });

  const load = useCallback(() => {
    void loadOp
      .run((signal) => getPlan(paymentId, signal))
      .then((p) => {
        if (p !== undefined) setPlan(p);
      });
    // loadOp identity is stable (useAsyncOperation contract).
  }, [paymentId, getPlan]);

  useEffect(() => {
    load();
  }, [load]);

  const cancelled = !!plan?.cancelledAt;
  const canManage = !!user && user.id === createdById;

  function runCancel() {
    setConfirmingCancel(false);
    void cancelOp
      .run((signal) => cancelPlan(paymentId, signal))
      .then((updated) => {
        if (updated === undefined) return;
        setPlan(updated);
        addToast('success', t('cancelledToast'));
      });
  }

  useEffect(() => {
    if (cancelOp.error && cancelOp.error.reason !== 'aborted') {
      addToast('error', cancelOp.error.message || t('cancelFailed'));
    }
    // addToast/t identities are stable enough; error is the trigger.
  }, [cancelOp.error]);

  if (loadOp.isLoading && !plan) {
    return (
      <section
        className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
        data-testid="plan-section-loading"
        role="status"
      >
        <div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      </section>
    );
  }

  if (loadOp.error && !plan) {
    return (
      <section
        className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
        data-testid="plan-section-error"
      >
        <InlineErrorBanner
          reason={loadOp.error.reason}
          httpStatus={loadOp.error.httpStatus}
          onRetry={load}
        />
      </section>
    );
  }

  if (!plan) return null;

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
      aria-labelledby="plan-section-title"
      data-testid="plan-section"
      data-cancelled={cancelled || undefined}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3
          id="plan-section-title"
          className="text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          {t(`kind.${plan.kind}`)}
        </h3>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
            cancelled
              ? 'border-gray-300 bg-gray-200 text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300'
              : 'border-green-200 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-900/40 dark:text-green-200'
          }`}
          data-testid="plan-status-pill"
        >
          {cancelled ? t('statusCancelled') : t('statusActive')}
        </span>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-200" data-testid="plan-summary">
        {t('summary', {
          principal: formatMoney(plan.principalCents, currency, locale),
          count: plan.paymentsCount,
          rate: (plan.interestRate * 100).toLocaleString(locale, { maximumFractionDigits: 2 }),
          frequency: t(`form.frequency.${plan.frequency}`),
          method: t(`form.method.${plan.amortizationMethod}`),
        })}
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm" data-testid="plan-table">
          <thead>
            <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <th className="py-1.5 pe-2 font-medium">#</th>
              <th className="py-1.5 pe-2 font-medium">{t('table.dueAt')}</th>
              <th className="py-1.5 pe-2 font-medium">{t('table.principal')}</th>
              <th className="py-1.5 pe-2 font-medium">{t('table.interest')}</th>
              <th className="py-1.5 pe-2 font-medium">{t('table.total')}</th>
              <th className="py-1.5 pe-2 font-medium">{t('table.remaining')}</th>
              <th className="py-1.5 font-medium">{t('table.status')}</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((row) => (
              <tr
                key={row.index}
                className="border-b border-gray-100 text-gray-800 last:border-0 dark:border-gray-700/60 dark:text-gray-100"
                data-testid={`plan-row-${row.index}`}
              >
                <td className="py-1.5 pe-2 text-gray-500 dark:text-gray-400">{row.index}</td>
                <td className="py-1.5 pe-2">{formatDate(row.dueAt, locale)}</td>
                <td className="py-1.5 pe-2">{formatMoney(row.principalCents, currency, locale)}</td>
                <td className="py-1.5 pe-2">{formatMoney(row.interestCents, currency, locale)}</td>
                <td className="py-1.5 pe-2 font-medium">
                  {formatMoney(row.totalCents, currency, locale)}
                </td>
                <td className="py-1.5 pe-2">{formatMoney(row.remainingCents, currency, locale)}</td>
                <td className="py-1.5">
                  {row.status ? (
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        ROW_STATUS_CLASSES[row.status] ?? ROW_STATUS_CLASSES.PENDING
                      }`}
                      data-testid={`plan-row-status-${row.index}`}
                    >
                      {t(`rowStatus.${row.status}`)}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && !cancelled && (
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="plan-actions">
          {!confirmingCancel ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmingCancel(true)}
              disabled={cancelOp.isLoading}
              data-testid="plan-action-cancel"
            >
              {t('cancelAction')}
            </Button>
          ) : (
            <span
              className="inline-flex flex-wrap items-center gap-2"
              data-testid="plan-cancel-confirm"
            >
              <span className="text-xs text-gray-600 dark:text-gray-300">
                {t('cancelConfirmBody')}
              </span>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={runCancel}
                disabled={cancelOp.isLoading}
                data-testid="plan-cancel-confirm-yes"
              >
                {t('cancelConfirmYes')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmingCancel(false)}
                disabled={cancelOp.isLoading}
                data-testid="plan-cancel-confirm-keep"
              >
                {t('cancelConfirmKeep')}
              </Button>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
