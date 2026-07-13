'use client';

// Phase 6 · Iteration 6.12 — single payment row.
// Two render variants:
//   - "desktop": a `<tr>` with 8 cells. Used inside a `<table>` body.
//   - "card":    a stacked `<li>` block, mobile-friendly.
//
// Both variants share identical click semantics (row click, star toggle,
// edit / delete callbacks). Star toggling is optimistic with revert on
// error, surfacing through `onStarToggled` so the parent list can update
// or remove the row depending on the active filter (e.g. starred=true).

import { useLocale, useTranslations } from 'next-intl';
import { type KeyboardEvent } from 'react';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { formatOccurredAt, formatScopeLabel, formatSignedAmount } from '@/lib/payment/formatters';
import { canEditPayment } from '@/lib/payment/types';
import type { PaymentSummary } from '@/lib/payment/types';
import { useStarToggle } from '@/lib/payment/use-star-toggle';

export type PaymentRowVariant = 'desktop' | 'card';

export interface PaymentRowProps {
  payment: PaymentSummary;
  variant: PaymentRowVariant;
  /** Hide the star icon (e.g. on the starred-only page). Default true. */
  showStar?: boolean;
  /** Hide the edit/delete controls (e.g. read-only view). Default true. */
  showControls?: boolean;
  /** Click handler for the row body — opens detail page in 6.16. */
  onClick?(id: string): void;
  /** Open the edit dialog (6.13). In 6.12 we wire to a no-op pass-through. */
  onEditClick?(id: string): void;
  onDeleteClick?(payment: PaymentSummary): void;
  /** Attach a receipt to this (expense) payment (8.15). Absent → no menu item. */
  onAttachClick?(payment: PaymentSummary): void;
  /** Reports the new starred state so the parent list can update / remove. */
  onStarToggled?(id: string, starred: boolean): void;
}

/** Truncate a comma-separated list of scope labels and provide title fallback. */
function truncateScopeList(labels: string[]): { display: string; full: string } {
  const full = labels.join(', ');
  if (labels.length <= 3) return { display: full, full };
  const display = labels.slice(0, 3).join(', ') + ` +${labels.length - 3}`;
  return { display, full };
}

export function PaymentRow({
  payment,
  variant,
  showStar = true,
  showControls = true,
  onClick,
  onEditClick,
  onDeleteClick,
  onAttachClick,
  onStarToggled,
}: PaymentRowProps) {
  const t = useTranslations('payments');
  const locale = useLocale();

  // Optimistic star state — shared hook provides flip + revert-on-error.
  const {
    starred,
    error: starError,
    pending: starPending,
    toggle: runToggleStar,
  } = useStarToggle(payment.id, payment.starredByMe, { onToggled: onStarToggled });

  const handleStar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await runToggleStar();
  };

  const handleRowClick = () => {
    if (!onClick) return;
    onClick(payment.id);
  };

  const handleRowKeyDown = (e: KeyboardEvent) => {
    if (!onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(payment.id);
    }
  };

  const handleEdit = () => {
    onEditClick?.(payment.id);
  };

  const handleDelete = () => {
    onDeleteClick?.(payment);
  };

  const handleAttach = () => {
    onAttachClick?.(payment);
  };

  // Prepare derived values shared between variants.
  const dateText = formatOccurredAt(payment.occurredAt, locale);
  const amountText = formatSignedAmount(payment, locale);
  const directionClass =
    payment.direction === 'IN'
      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
      : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200';
  const directionLabel = payment.direction === 'IN' ? t('directions.in') : t('directions.out');
  const tFn = (key: string) => t(key);
  const scopeLabels = payment.attributions.map((a) => formatScopeLabel(a, tFn));
  const scopes = truncateScopeList(scopeLabels);
  const note = payment.note ?? '';
  const starGlyph = starred ? '★' : '☆';
  const starAria = starred ? t('row.starRemove') : t('row.starAdd');
  const starColor = starred ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500';

  // ── Reusable inner blocks ─────────────────────────────────────────────────

  const starButton = showStar ? (
    <button
      type="button"
      onClick={handleStar}
      data-testid={`row-star-${payment.id}`}
      aria-label={starAria}
      aria-pressed={starred}
      aria-busy={starPending}
      disabled={starPending}
      title={starError ?? undefined}
      className={`text-lg leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 ${starColor}`}
    >
      {starPending ? (
        <ButtonSpinner size="sm" data-testid={`row-star-spinner-${payment.id}`} />
      ) : (
        starGlyph
      )}
    </button>
  ) : null;

  // Phase 6 · Iteration 6.18.1.2 — disable the Edit/Delete menu entries
  // when the form can't handle this payment (child occurrences + future
  // types) so the row-level affordance matches the detail page's rule.
  const formCanEdit = canEditPayment(payment);
  const controlsMenu = showControls ? (
    <RowActionsMenu
      triggerLabel={t('table.controls')}
      testId={`row-controls-${payment.id}`}
      items={[
        {
          key: 'edit',
          label: t('controls.edit'),
          onClick: handleEdit,
          disabled: !formCanEdit,
          testId: `row-edit-${payment.id}`,
        },
        // Attach a receipt — expense payments only (receipts are OUT proving
        // documents) and only when the parent wires the handler.
        ...(onAttachClick && payment.direction === 'OUT'
          ? [
              {
                key: 'attach',
                label: t('controls.attachReceipt'),
                onClick: handleAttach,
                testId: `row-attach-${payment.id}`,
              },
            ]
          : []),
        {
          key: 'delete',
          label: t('controls.delete'),
          destructive: true,
          onClick: handleDelete,
          disabled: !formCanEdit,
          testId: `row-delete-${payment.id}`,
        },
      ]}
    />
  ) : null;

  const directionPill = (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${directionClass}`}
      data-testid={`row-direction-${payment.id}`}
      data-direction={payment.direction}
    >
      {directionLabel}
    </span>
  );

  // ── Desktop variant (table row) ───────────────────────────────────────────
  if (variant === 'desktop') {
    return (
      <tr
        data-testid={`payment-row-${payment.id}`}
        onClick={onClick ? handleRowClick : undefined}
        onKeyDown={onClick ? handleRowKeyDown : undefined}
        tabIndex={onClick ? 0 : undefined}
        className={`border-b border-gray-100 dark:border-gray-700 ${
          onClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40' : ''
        }`}
      >
        <td className="px-2 py-2 align-middle">{starButton}</td>
        <td className="px-2 py-2 align-middle text-sm text-gray-700 dark:text-gray-300">
          {dateText}
        </td>
        <td className="px-2 py-2 align-middle">{directionPill}</td>
        <td
          className="px-2 py-2 text-end align-middle font-mono text-sm text-gray-900 dark:text-gray-100"
          data-testid={`row-amount-${payment.id}`}
        >
          {amountText}
        </td>
        <td className="px-2 py-2 align-middle text-sm text-gray-700 dark:text-gray-300">
          {payment.category.name}
        </td>
        <td
          className="px-2 py-2 align-middle text-sm text-gray-700 dark:text-gray-300"
          data-testid={`row-scopes-${payment.id}`}
          title={scopes.full}
        >
          {scopes.display}
        </td>
        <td className="px-2 py-2 align-middle text-sm text-gray-700 dark:text-gray-300">
          <span
            className="block max-w-[24ch] truncate"
            data-testid={`row-note-${payment.id}`}
            title={note}
          >
            {note}
          </span>
        </td>
        <td className="px-2 py-2 align-middle">{controlsMenu}</td>
      </tr>
    );
  }

  // ── Card variant (mobile list item) ───────────────────────────────────────
  return (
    <li
      data-testid={`payment-row-${payment.id}`}
      onClick={onClick ? handleRowClick : undefined}
      onKeyDown={onClick ? handleRowKeyDown : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`flex flex-col gap-1 rounded-md border border-gray-200 p-3 dark:border-gray-700 ${
        onClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        {directionPill}
        <span
          className="ms-auto font-mono text-sm text-gray-900 dark:text-gray-100"
          data-testid={`row-amount-${payment.id}`}
        >
          {amountText}
        </span>
        {starButton}
        {controlsMenu}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400">
        {dateText} · {payment.category.name}
      </div>
      <div
        className="text-xs text-gray-700 dark:text-gray-300"
        data-testid={`row-scopes-${payment.id}`}
        title={scopes.full}
      >
        {scopes.display}
        {note && (
          <span className="ms-1 text-gray-500 dark:text-gray-400">
            · <span title={note}>{note}</span>
          </span>
        )}
      </div>
    </li>
  );
}
