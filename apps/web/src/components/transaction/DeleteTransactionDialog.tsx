'use client';

// Phase 6 · Iteration 6.12 — scope-aware payment delete dialog (design §2.4).
// Phase 6 · Iteration 6.16.4 — delete flow uses
// useAsyncOperation({ scope: 'control' }). Confirm button shows
// <ButtonSpinner>, scope inputs disabled while in flight, Cancel triggers
// cancel(). Network/timeout/HTTP failures surface via inline banner with
// Retry. Domain errors keep the existing `<div data-testid="delete-payment-error">`
// inline message contract (no banner double-render).

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useAuth } from '@/lib/auth/auth-context';
import { useGroups } from '@/lib/group/group-context';
import { usePayments } from '@/lib/payment/payment-context';
import type {
  AttributionChangeResult,
  PaymentAttribution,
  PaymentSummary,
} from '@/lib/payment/types';
import { useAsyncOperation } from '@/lib/ui';

export interface DeletePaymentDialogProps {
  payment: PaymentSummary;
  onClose(): void;
  onDeleted(result: AttributionChangeResult): void;
  /**
   * Forces the dialog into "this-scope" mode, locked to a specific scope.
   */
  singleScope?: string;
}

interface AccessibleScope {
  key: string;
  label: string;
  attribution: PaymentAttribution;
}

export function DeletePaymentDialog({
  payment,
  onClose,
  onDeleted,
  singleScope,
}: DeletePaymentDialogProps) {
  const t = useTranslations('payments');
  const tDelete = useTranslations('payments.delete');
  const { user } = useAuth();
  const { groups } = useGroups();
  const { removePayment } = usePayments();

  const accessible: AccessibleScope[] = useMemo(() => {
    if (!user) return [];
    const groupIds = new Set(groups.map((g) => g.id));
    const list: AccessibleScope[] = [];
    for (const a of payment.attributions) {
      if (a.scope === 'personal' && a.userId === user.id) {
        list.push({
          key: 'personal',
          label: t('scope.personal'),
          attribution: a,
        });
      } else if (a.scope === 'group' && a.groupId && groupIds.has(a.groupId)) {
        list.push({
          key: `group:${a.groupId}`,
          label: a.groupName ?? t('scope.group'),
          attribution: a,
        });
      }
    }
    return list;
  }, [payment.attributions, groups, user, t]);

  const noAccess = accessible.length === 0;
  const forcedSingle = !!singleScope;

  const [mode, setMode] = useState<'this' | 'all'>(() => {
    if (forcedSingle) return 'this';
    return accessible.length <= 1 ? 'this' : 'all';
  });

  const initialPick = forcedSingle
    ? singleScope
    : accessible.length === 1
      ? accessible[0].key
      : accessible[0]?.key;
  const [pickedScope, setPickedScope] = useState<string | undefined>(initialPick);

  const forcedScopeAccessible = !forcedSingle || accessible.some((a) => a.key === singleScope);
  const effectiveNoAccess = noAccess || !forcedScopeAccessible;

  const deleteOp = useAsyncOperation<AttributionChangeResult>({ scope: 'control' });
  const isLoading = deleteOp.isLoading;

  // ESC closes the dialog (also aborts the in-flight op).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        deleteOp.cancel();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, deleteOp]);

  function buildScope(): string | undefined {
    if (forcedSingle) return singleScope;
    if (mode === 'this') return pickedScope;
    return 'all';
  }

  function runDelete() {
    if (effectiveNoAccess || isLoading) return;
    const scopeArg = buildScope();
    void deleteOp
      .run((signal) => removePayment(payment.id, scopeArg, signal))
      .then((result) => {
        if (!result) return;
        onDeleted(result);
        onClose();
      });
  }

  function handleCancel() {
    deleteOp.cancel();
    onClose();
  }

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) handleCancel();
  };

  // The "all" mode is meaningful only when there's > 1 accessible scope.
  const allowsAll = !forcedSingle && accessible.length > 1;
  const allowsThisWithPicker = !forcedSingle && accessible.length > 1 && mode === 'this';

  // Distinguish HTTP errors with a domain message (preserved below) vs
  // network/timeout (full inline banner with retry). Both go through the
  // same error state — we surface the message either way.
  const showBanner =
    deleteOp.isError && deleteOp.error !== null && deleteOp.error.reason !== 'aborted';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-payment-title"
      data-testid="delete-payment-dialog"
      onMouseDown={handleBackdrop}
      aria-busy={isLoading || undefined}
    >
      <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h3
          id="delete-payment-title"
          className="mb-4 text-lg font-semibold text-red-600 dark:text-red-400"
        >
          {tDelete('title')}
        </h3>

        {effectiveNoAccess ? (
          <div
            className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
            role="alert"
            data-testid="delete-payment-no-access"
          >
            {tDelete('errorNoAccess')}
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
              {tDelete('description')}
            </p>

            <ul
              className="mb-4 space-y-1 rounded-md border border-gray-200 p-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300"
              data-testid="delete-payment-accessible-list"
            >
              {accessible.map((s) => (
                <li key={s.key} data-testid={`delete-payment-accessible-${s.key}`}>
                  • {s.label}
                </li>
              ))}
            </ul>

            <div className="mb-4 space-y-2" role="radiogroup" aria-label={tDelete('title')}>
              <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input
                  type="radio"
                  name="delete-mode"
                  value="this"
                  checked={mode === 'this'}
                  onChange={() => setMode('this')}
                  disabled={isLoading}
                  data-testid="delete-mode-this"
                  className="mt-1"
                />
                <span>{tDelete('scopeOnly')}</span>
              </label>

              {allowsAll && (
                <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="radio"
                    name="delete-mode"
                    value="all"
                    checked={mode === 'all'}
                    onChange={() => setMode('all')}
                    disabled={isLoading}
                    data-testid="delete-mode-all"
                    className="mt-1"
                  />
                  <span>{tDelete('scopeAll', { count: accessible.length })}</span>
                </label>
              )}
            </div>

            {allowsThisWithPicker && (
              <div
                className="mb-4 space-y-1 rounded-md border border-gray-200 p-2 dark:border-gray-700"
                role="radiogroup"
                aria-label={tDelete('pickScope')}
                data-testid="delete-scope-picker"
              >
                <p className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                  {tDelete('pickScope')}
                </p>
                {accessible.map((s) => (
                  <label
                    key={s.key}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
                  >
                    <input
                      type="radio"
                      name="delete-pick-scope"
                      value={s.key}
                      checked={pickedScope === s.key}
                      onChange={() => setPickedScope(s.key)}
                      disabled={isLoading}
                      data-testid={`delete-scope-pick-${s.key}`}
                    />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        {showBanner && deleteOp.error && (
          <div className="mb-4">
            {/* Preserve legacy error testid for spec compatibility — show the
                raw message inline so older assertions keep passing. */}
            <p
              className="mb-2 text-sm text-red-700 dark:text-red-300"
              role="alert"
              data-testid="delete-payment-error"
            >
              {deleteOp.error.message ?? deleteOp.error.reason}
            </p>
            <InlineErrorBanner
              reason={deleteOp.error.reason}
              httpStatus={deleteOp.error.httpStatus}
              message={deleteOp.error.message ?? undefined}
              onRetry={() => void deleteOp.retry()}
              retrying={isLoading}
              data-testid="delete-payment-error-banner"
            />
          </div>
        )}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="flex-1"
            onClick={handleCancel}
            data-testid="delete-payment-cancel"
          >
            {tDelete('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="flex-1 !bg-red-600 hover:!bg-red-700 focus:!ring-red-500"
            onClick={runDelete}
            disabled={isLoading || effectiveNoAccess}
            aria-busy={isLoading}
            data-testid="delete-payment-confirm"
          >
            {isLoading ? (
              <span className="inline-flex items-center justify-center gap-2">
                <ButtonSpinner />
                <span>{tDelete('confirm')}</span>
              </span>
            ) : (
              tDelete('confirm')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
