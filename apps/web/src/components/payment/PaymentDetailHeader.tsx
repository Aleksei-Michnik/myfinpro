'use client';

// Phase 6 · Iteration 6.14 — top section of the payment detail page.
//
// Visual: direction badge, amount, date, category, attributions list with
// group links, note (or "no note" fallback), star/edit/delete controls.
// Star behaviour is delegated to the shared `useStarToggle` hook so the
// optimistic flip + revert logic is DRY with `<PaymentRow>`.

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useGroups } from '@/lib/group/group-context';
import { formatOccurredAt, formatScopeLabel, formatSignedAmount } from '@/lib/payment/formatters';
import { canEditPayment, cannotEditReason } from '@/lib/payment/types';
import type { PaymentSummary } from '@/lib/payment/types';
import { useStarToggle } from '@/lib/payment/use-star-toggle';

export interface PaymentDetailHeaderProps {
  payment: PaymentSummary;
  onEditClick(): void;
  onDeleteClick(): void;
  onStarToggled?(starred: boolean): void;
}

export function PaymentDetailHeader({
  payment,
  onEditClick,
  onDeleteClick,
  onStarToggled,
}: PaymentDetailHeaderProps) {
  const t = useTranslations('payments');
  const tDetail = useTranslations('payments.detail');
  const locale = useLocale();
  const { user } = useAuth();
  const { groups } = useGroups();

  const {
    starred,
    error: starError,
    pending: starPending,
    toggle: runToggleStar,
  } = useStarToggle(payment.id, payment.starredByMe, {
    onToggled: (_id, s) => onStarToggled?.(s),
  });

  const dateText = formatOccurredAt(payment.occurredAt, locale);
  const amountText = formatSignedAmount(payment, locale);
  const directionClass =
    payment.direction === 'IN'
      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
      : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200';
  const directionLabel = payment.direction === 'IN' ? t('directions.in') : t('directions.out');

  const tFn = (key: string) => t(key);

  // Phase 6 · Iteration 6.18.1.2 — edit/delete eligibility is a single
  // shared rule (`canEditPayment`): not a generated occurrence + a type
  // the form supports (`ONE_TIME` / `RECURRING`). Authorisation (creator)
  // is layered on top.
  // Phase 6 · Iteration 6.18.1.2 — edit/delete eligibility is a single
  // shared rule (`canEditPayment`): not a generated occurrence + a type
  // the form supports (`ONE_TIME` / `RECURRING`). The Edit button is
  // additionally guarded by creator authorisation; the Delete button is
  // not (the API allows a non-creator to remove their own attribution).
  const isCreator = !!user && user.id === payment.createdById;
  const formCanEdit = canEditPayment(payment);
  const cannotReason = cannotEditReason(payment);
  const canEdit = isCreator && formCanEdit;
  const canDelete = formCanEdit;
  const formDisabledReason =
    cannotReason === 'generatedOccurrence'
      ? tDetail('editDisabled.generatedOccurrence')
      : cannotReason === 'unsupportedType'
        ? tDetail('editDisabled.unsupportedType')
        : undefined;
  const editDisabledReason = !isCreator ? tDetail('editDisabledNotCreator') : formDisabledReason;

  const groupMembership = new Set(groups.map((g) => g.id));
  const note = (payment.note ?? '').trim();
  const starGlyph = starred ? '★' : '☆';
  const starLabel = starred ? tDetail('starRemove') : tDetail('starAdd');
  const starColor = starred ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500';

  return (
    <header
      data-testid="payment-detail-header"
      className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${directionClass}`}
          data-testid="detail-direction"
          data-direction={payment.direction}
        >
          {directionLabel}
        </span>
        <span
          className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200"
          data-testid="detail-type"
        >
          {payment.type}
        </span>
        <span
          className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
          data-testid="detail-status"
        >
          {payment.status}
        </span>
      </div>

      <div
        className="mb-1 font-mono text-2xl font-bold text-gray-900 dark:text-gray-100"
        data-testid="detail-amount"
      >
        {amountText}
      </div>

      <dl className="mb-3 grid grid-cols-1 gap-1 text-sm text-gray-700 dark:text-gray-300 sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-gray-500 dark:text-gray-400">{tDetail('dateLabel')}:</dt>
          <dd data-testid="detail-date">{dateText}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-gray-500 dark:text-gray-400">{tDetail('categoryLabel')}:</dt>
          <dd data-testid="detail-category">{payment.category.name}</dd>
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <dt className="text-gray-500 dark:text-gray-400">{tDetail('attributionsLabel')}:</dt>
          <dd className="flex flex-wrap gap-x-1 gap-y-0" data-testid="detail-attributions">
            {payment.attributions.map((a, idx) => {
              const label = formatScopeLabel(a, tFn);
              const comma = idx < payment.attributions.length - 1 ? ',' : '';
              if (a.scope === 'group' && a.groupId && groupMembership.has(a.groupId)) {
                return (
                  <span key={`${a.scope}-${a.groupId ?? idx}`}>
                    <Link
                      href={`/groups/${a.groupId}`}
                      className="text-primary-700 hover:underline dark:text-primary-300"
                      data-testid={`detail-attribution-link-${a.groupId}`}
                    >
                      {label}
                    </Link>
                    {comma}
                  </span>
                );
              }
              return (
                <span key={`${a.scope}-${a.groupId ?? idx}`}>
                  {label}
                  {comma}
                </span>
              );
            })}
          </dd>
        </div>
      </dl>

      <div className="mb-4">
        <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          {tDetail('noteLabel')}
        </div>
        {note.length === 0 ? (
          <p
            className="text-sm italic text-gray-400 dark:text-gray-500"
            data-testid="detail-no-note"
          >
            {tDetail('noNote')}
          </p>
        ) : (
          <blockquote
            className="whitespace-pre-wrap rounded-md border-l-4 border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-200"
            data-testid="detail-note"
          >
            {note}
          </blockquote>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runToggleStar()}
          aria-label={starLabel}
          aria-pressed={starred}
          aria-busy={starPending}
          disabled={starPending}
          title={starError ?? undefined}
          data-testid="detail-star"
          className={`inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 dark:border-gray-600 ${starColor}`}
        >
          {starPending ? (
            <ButtonSpinner size="sm" data-testid="detail-star-spinner" />
          ) : (
            <span className="text-lg leading-none">{starGlyph}</span>
          )}
          {starLabel}
        </button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onEditClick}
          disabled={!canEdit}
          aria-disabled={!canEdit || undefined}
          title={editDisabledReason}
          data-testid="detail-edit"
        >
          {tDetail('edit')}
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={onDeleteClick}
          disabled={!canDelete}
          aria-disabled={!canDelete || undefined}
          title={canDelete ? undefined : formDisabledReason}
          data-testid="detail-delete"
        >
          {tDetail('delete')}
        </Button>
      </div>
    </header>
  );
}
