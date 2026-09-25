'use client';

// Phase 20 · Iteration 20.3 — one account card on the /accounts list (UI
// spec §1 "Card anatomy"): name, kind + institution + last4 chips, ⋮ menu,
// scope + archived chips, ledger/reported balance stats, and the
// reconciliation gap / pending-lines badges. Mirrors `BudgetCard`.

import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import { Stat } from '@/components/ui/Stat';
import { Link } from '@/i18n/navigation';
import { displayLedgerCents, isCardOwed, isReconciled } from '@/lib/account/formatters';
import { INSTITUTION_META, type AccountSummary } from '@/lib/account/types';
import { formatAmount, formatOccurredDate, formatScopeLabel } from '@/lib/transaction/formatters';

export interface AccountCardProps {
  account: AccountSummary;
  /** The caller's groups — resolve the scope chip's name + the admin role. */
  groups: { id: string; name: string; role?: string }[];
  /** Cascades from the page's in-flight archive/unarchive/delete op. */
  actionsDisabled?: boolean;
  onEdit(account: AccountSummary): void;
  /** Absent until the import wizard ships (20.5) — the menu item is hidden. */
  onImport?(account: AccountSummary): void;
  onToggleArchive(account: AccountSummary): void;
  onDelete(account: AccountSummary): void;
}

export function AccountCard({
  account,
  groups,
  actionsDisabled,
  onEdit,
  onImport,
  onToggleArchive,
  onDelete,
}: AccountCardProps) {
  const t = useTranslations('accounts');
  const tTransactions = useTranslations('transactions');
  const locale = useLocale();

  const archived = account.archivedAt !== null && account.archivedAt !== undefined;
  const group = account.groupId ? groups.find((g) => g.id === account.groupId) : undefined;
  const canManage =
    account.scopeType === 'personal' || (group?.role ?? '').toLowerCase() === 'admin';

  const institutionName = account.institution
    ? INSTITUTION_META[account.institution as keyof typeof INSTITUTION_META]?.name
    : null;

  const owed = isCardOwed(account);
  const ledgerCents = displayLedgerCents(account);
  const gap = account.reconciliationGapCents;
  const reconciled = isReconciled(gap);

  return (
    <Card
      as="li"
      padding="sm"
      muted={archived}
      className={archived ? 'opacity-70' : undefined}
      data-testid={`account-card-${account.id}`}
      data-archived={archived || undefined}
    >
      {/* Row 1 — name · kind · institution · last4 · ⋮ */}
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span
            className="min-w-0 max-w-full truncate text-sm font-medium text-gray-900 dark:text-gray-100"
            data-testid={`account-name-${account.id}`}
          >
            {account.name}
          </span>
          <Badge tone="primary" data-testid={`account-kind-${account.id}`}>
            {t(`kinds.${account.kind}`)}
          </Badge>
          {institutionName && (
            <Badge tone="neutral" data-testid={`account-institution-${account.id}`}>
              {institutionName}
            </Badge>
          )}
          {account.last4 && (
            <span
              dir="ltr"
              className="text-xs text-gray-500 dark:text-gray-400"
              data-testid={`account-last4-${account.id}`}
            >
              {t('card.last4', { digits: account.last4 })}
            </span>
          )}
        </div>
        {canManage && (
          <span className="shrink-0">
            <RowActionsMenu
              triggerLabel={t('list.actions')}
              testId={`account-actions-${account.id}`}
              items={[
                {
                  key: 'edit',
                  label: t('list.edit'),
                  onClick: () => onEdit(account),
                  disabled: actionsDisabled || archived,
                  testId: `account-edit-${account.id}`,
                },
                ...(onImport
                  ? [
                      {
                        key: 'import',
                        label: t('list.import'),
                        onClick: () => onImport(account),
                        testId: `account-import-${account.id}`,
                      },
                    ]
                  : []),
                {
                  key: 'archive',
                  label: archived ? t('list.unarchive') : t('list.archive'),
                  onClick: () => onToggleArchive(account),
                  disabled: actionsDisabled,
                  testId: `account-archive-${account.id}`,
                },
                {
                  key: 'delete',
                  label: t('list.delete'),
                  destructive: true,
                  onClick: () => onDelete(account),
                  disabled: actionsDisabled,
                  testId: `account-delete-${account.id}`,
                },
              ]}
            />
          </span>
        )}
      </div>

      {/* Row 2 — scope · archived */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <Badge tone="primary" data-testid={`account-scope-${account.id}`}>
          {formatScopeLabel({ scope: account.scopeType, groupName: group?.name ?? null }, (key) =>
            tTransactions(key),
          )}
        </Badge>
        {archived && (
          <Badge tone="neutral" data-testid={`account-archived-${account.id}`}>
            {t('list.archivedChip')}
          </Badge>
        )}
      </div>

      {/* Row 3 — ledger / reported balance */}
      <div className="mt-3 flex flex-wrap gap-4 sm:gap-6">
        <Stat
          label={owed ? t('card.owed') : t('card.ledger')}
          value={formatAmount(ledgerCents, account.currency, locale)}
          hint={t('card.ledgerHint', { date: formatOccurredDate(account.ledgerBalanceAt, locale) })}
          tone={owed ? 'negative' : 'neutral'}
          data-testid={`account-ledger-${account.id}`}
        />
        {account.reportedBalanceCents !== null && account.reportedBalanceCents !== undefined && (
          <Stat
            label={t('card.reported')}
            value={formatAmount(account.reportedBalanceCents, account.currency, locale)}
            hint={
              account.reportedBalanceAt
                ? t('card.reportedHint', {
                    date: formatOccurredDate(account.reportedBalanceAt, locale),
                  })
                : undefined
            }
            data-testid={`account-reported-${account.id}`}
          />
        )}
      </div>

      {/* Row 4 — reconciliation gap · pending lines */}
      {(gap !== null && gap !== undefined) || account.pendingLinesCount > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          {gap !== null && gap !== undefined && (
            <Badge
              tone={reconciled ? 'success' : 'warning'}
              data-testid={`account-gap-${account.id}`}
            >
              {reconciled
                ? t('card.reconciled')
                : t('card.gap', { amount: formatAmount(gap, account.currency, locale) })}
            </Badge>
          )}
          {account.pendingLinesCount > 0 && (
            <Link href={`/accounts/${account.id}?tab=review`}>
              <Badge tone="warning" data-testid={`account-pending-${account.id}`}>
                {t('card.pending', { count: account.pendingLinesCount })}
              </Badge>
            </Link>
          )}
        </div>
      ) : null}
    </Card>
  );
}
