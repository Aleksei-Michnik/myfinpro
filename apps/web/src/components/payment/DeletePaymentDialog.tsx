'use client';

// Phase 6 · Iteration 6.12 — scope-aware payment delete dialog (design §2.4).
//
// Computes the *accessible* attributions for the current caller and offers
// only those as removal targets. Non-accessible attributions are silently
// preserved by the backend; the dialog must NEVER reveal them.
//
// Two delete modes:
//   - "this scope": single-attribution removal (?scope=...). Disabled when
//     accessible-count > 1 unless `singleScope` is forced (used by detail
//     page's per-scope delete in 6.16).
//   - "all":         multi-attribution removal across every accessible
//     scope (no ?scope=... query, backend treats as "all caller's scopes").

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/lib/auth/auth-context';
import { useGroups } from '@/lib/group/group-context';
import { usePayments } from '@/lib/payment/payment-context';
import type {
  AttributionChangeResult,
  PaymentAttribution,
  PaymentSummary,
} from '@/lib/payment/types';

export interface DeletePaymentDialogProps {
  payment: PaymentSummary;
  onClose(): void;
  onDeleted(result: AttributionChangeResult): void;
  /**
   * Forces the dialog into "this-scope" mode, locked to a specific scope
   * (e.g. when the detail page hosts a per-scope delete button). The given
   * scope still has to be in the caller's accessible list — otherwise the
   * dialog renders the no-access error.
   */
  singleScope?: string;
}

/** A scope option presented to the user (already filtered by access). */
interface AccessibleScope {
  /** API token: 'personal' | 'group:<id>' */
  key: string;
  /** Human label as rendered by `formatScopeLabel`. */
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

  // ── Compute accessible scopes ─────────────────────────────────────────────
  // Per design §2.4, an attribution is accessible iff:
  //   - scope='personal' AND userId === currentUser.id
  //   - scope='group'    AND currentUser is a member of groupId
  //
  // We use `useGroups().groups` as the source of truth for membership: the
  // list returned by GET /api/v1/groups only contains groups where the
  // user IS a member.
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

  // Default selection: "all" when the user has multiple accessible scopes,
  // "this scope" otherwise (or when forced).
  const [mode, setMode] = useState<'this' | 'all'>(() => {
    if (forcedSingle) return 'this';
    return accessible.length <= 1 ? 'this' : 'all';
  });

  // Picked scope (for "this scope" mode with multiple options).
  const initialPick = forcedSingle
    ? singleScope
    : accessible.length === 1
      ? accessible[0].key
      : accessible[0]?.key;
  const [pickedScope, setPickedScope] = useState<string | undefined>(initialPick);

  // Validate: in forced-single mode the scope MUST be in the accessible list.
  const forcedScopeAccessible = !forcedSingle || accessible.some((a) => a.key === singleScope);
  const effectiveNoAccess = noAccess || !forcedScopeAccessible;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESC closes the dialog.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleConfirm = async () => {
    if (effectiveNoAccess || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      let scopeArg: string | undefined;
      if (forcedSingle) {
        scopeArg = singleScope;
      } else if (mode === 'this') {
        scopeArg = pickedScope;
      } else {
        scopeArg = 'all';
      }
      const r = await removePayment(payment.id, scopeArg);
      onDeleted(r);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to delete payment');
      setSubmitting(false);
    }
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  // The "all" mode is meaningful only when there's > 1 accessible scope.
  const allowsAll = !forcedSingle && accessible.length > 1;
  const allowsThisWithPicker = !forcedSingle && accessible.length > 1 && mode === 'this';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-payment-title"
      data-testid="delete-payment-dialog"
      onMouseDown={handleBackdrop}
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

            {/* Read-only list of *accessible* scopes the user controls. */}
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
                    data-testid="delete-mode-all"
                    className="mt-1"
                  />
                  <span>{tDelete('scopeAll', { count: accessible.length })}</span>
                </label>
              )}
            </div>

            {/* Scope picker visible when "this scope" + multiple accessible. */}
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
                      data-testid={`delete-scope-pick-${s.key}`}
                    />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        {error && (
          <div
            className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
            role="alert"
            data-testid="delete-payment-error"
          >
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="flex-1"
            onClick={onClose}
            disabled={submitting}
            data-testid="delete-payment-cancel"
          >
            {tDelete('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="flex-1 !bg-red-600 hover:!bg-red-700 focus:!ring-red-500"
            onClick={handleConfirm}
            disabled={submitting || effectiveNoAccess}
            data-testid="delete-payment-confirm"
          >
            {submitting ? '...' : tDelete('confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
