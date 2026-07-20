'use client';

// Phase 10 · Iteration 10.4 — one budget card on the /budgets list (design
// §7): name, scope chip (Personal / group name), category chip (or "All
// spending"), period label (incl. the CUSTOM date range), formatted amount,
// archived styling, and the row-actions ⋮ menu (edit / archive / delete).
// The progress row (spent / remaining / pct bar) mounts under the chips once
// the progress API ships (10.5, wired in 10.6) — nothing is faked here.

import { useLocale, useTranslations } from 'next-intl';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import type { BudgetSummary } from '@/lib/budget/types';
import { formatAmount, formatOccurredDate, formatScopeLabel } from '@/lib/transaction/formatters';

export interface BudgetCardProps {
  budget: BudgetSummary;
  /** The caller's groups — resolve the scope chip's name + the admin role. */
  groups: { id: string; name: string; role?: string }[];
  /** Cascades from the page's in-flight archive/unarchive op. */
  actionsDisabled?: boolean;
  onEdit(budget: BudgetSummary): void;
  onToggleArchive(budget: BudgetSummary): void;
  onDelete(budget: BudgetSummary): void;
}

export function BudgetCard({
  budget,
  groups,
  actionsDisabled,
  onEdit,
  onToggleArchive,
  onDelete,
}: BudgetCardProps) {
  const t = useTranslations('budgets');
  // The scope chip reuses the transaction scope labels (same values by
  // design — one key per value, per the DRY rule).
  const tTransactions = useTranslations('transactions');
  const locale = useLocale();

  const archived = budget.archivedAt !== null;
  const group = budget.groupId ? groups.find((g) => g.id === budget.groupId) : undefined;
  // Group budgets are admin-managed — members see the card without the ⋮
  // menu (the API deliberately 403s their mutations, design §2.3).
  const canManage =
    budget.scopeType === 'personal' || (group?.role ?? '').toLowerCase() === 'admin';

  const periodLabel =
    budget.period === 'CUSTOM' && budget.startsAt && budget.endsAt
      ? t('list.customRange', {
          start: formatOccurredDate(budget.startsAt, locale),
          end: formatOccurredDate(budget.endsAt, locale),
        })
      : t(`form.periods.${budget.period}`);

  return (
    <li
      className={`rounded-lg border border-gray-200 p-4 dark:border-gray-700 ${
        archived ? 'bg-gray-50 opacity-70 dark:bg-gray-900/40' : 'bg-white dark:bg-gray-800'
      }`}
      data-testid={`budget-card-${budget.id}`}
      data-archived={archived || undefined}
    >
      <div className="flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100"
          data-testid={`budget-name-${budget.id}`}
        >
          {budget.name}
        </span>
        <span
          className="font-mono text-sm text-gray-900 dark:text-gray-100"
          data-testid={`budget-amount-${budget.id}`}
        >
          {formatAmount(budget.amountCents, budget.currency, locale)}
        </span>
        {canManage && (
          <RowActionsMenu
            triggerLabel={t('list.actions')}
            testId={`budget-actions-${budget.id}`}
            items={[
              {
                key: 'edit',
                label: t('list.edit'),
                onClick: () => onEdit(budget),
                // Archived budgets reject edits (BUDGET_ARCHIVED) — unarchive first.
                disabled: actionsDisabled || archived,
                testId: `budget-edit-${budget.id}`,
              },
              {
                key: 'archive',
                label: archived ? t('list.unarchive') : t('list.archive'),
                onClick: () => onToggleArchive(budget),
                disabled: actionsDisabled,
                testId: `budget-archive-${budget.id}`,
              },
              {
                key: 'delete',
                label: t('list.delete'),
                destructive: true,
                onClick: () => onDelete(budget),
                disabled: actionsDisabled,
                testId: `budget-delete-${budget.id}`,
              },
            ]}
          />
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span
          className="inline-flex rounded-full bg-primary-50 px-2 py-0.5 font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
          data-testid={`budget-scope-${budget.id}`}
        >
          {formatScopeLabel({ scope: budget.scopeType, groupName: group?.name ?? null }, (key) =>
            tTransactions(key),
          )}
        </span>
        <span
          className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
          data-testid={`budget-category-${budget.id}`}
        >
          {budget.category
            ? `${budget.category.icon ? `${budget.category.icon} ` : ''}${budget.category.name}`
            : t('form.categoryAll')}
        </span>
        <span
          className="text-gray-500 dark:text-gray-400"
          data-testid={`budget-period-${budget.id}`}
        >
          {periodLabel}
        </span>
        {archived && (
          <span
            className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
            data-testid={`budget-archived-${budget.id}`}
          >
            {t('list.archivedChip')}
          </span>
        )}
      </div>

      {/* Progress row (spent / remaining / pct) slots in here — 10.5/10.6. */}
    </li>
  );
}
