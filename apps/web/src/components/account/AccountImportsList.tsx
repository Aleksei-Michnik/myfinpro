'use client';

// Phase 20 · 20.5 — the Imports tab (UI spec §6): one card per import on a
// phone, a table from `md:`. A row click narrows the Review tab to that import.

import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AccountImport } from '@/lib/account/types';
import { formatAmount, formatOccurredDate } from '@/lib/transaction/formatters';

export interface AccountImportsListProps {
  imports: AccountImport[];
  currency: string;
  hasMore: boolean;
  loading: boolean;
  onLoadMore(): void;
  onSelect(importId: string): void;
  /** Rendered when there is nothing to list (the "Import statement" action lives with the host). */
  emptyAction?: React.ReactNode;
}

export function AccountImportsList({
  imports,
  currency,
  hasMore,
  loading,
  onLoadMore,
  onSelect,
  emptyAction,
}: AccountImportsListProps) {
  const t = useTranslations('accounts.imports');
  const tDetail = useTranslations('accounts.detail');
  const tImport = useTranslations('accounts.import');
  const tReview = useTranslations('accounts.review');
  const locale = useLocale();

  if (imports.length === 0 && !loading) {
    return (
      <EmptyState
        title={tDetail('noImports')}
        action={emptyAction}
        data-testid="account-imports-empty"
      />
    );
  }

  const pendingOf = (i: AccountImport) =>
    i.suggestedMatchCount + i.suggestedTransferCount + i.suggestedCreateCount + i.needsInputCount;
  const sourceLabel = (source: string) =>
    (
      [
        'hapoalim',
        'leumi',
        'discount',
        'mizrahi',
        'isracard',
        'cal',
        'max',
        'amex',
        'generic_csv',
        'manual',
        'connector',
      ] as const
    ).includes(source as never)
      ? tImport(`sources.${source as 'manual'}`)
      : source;

  return (
    <div className="space-y-3" data-testid="account-imports">
      {/* Phone: cards */}
      <ul className="space-y-2 md:hidden" role="list">
        {imports.map((i) => (
          <Card
            key={i.id}
            as="li"
            padding="sm"
            className="cursor-pointer"
            onClick={() => onSelect(i.id)}
            data-testid={`import-row-${i.id}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{formatOccurredDate(i.createdAt, locale)}</span>
              <Badge tone="neutral">{sourceLabel(i.source)}</Badge>
            </div>
            {i.originalName && (
              <p dir="ltr" className="truncate text-xs text-gray-500 dark:text-gray-400">
                {i.originalName}
              </p>
            )}
            <p
              className="mt-1 text-xs text-gray-600 dark:text-gray-300"
              data-testid={`import-row-counts-${i.id}`}
            >
              {t('rows')} {i.totalCount} · {t('inserted')} {i.insertedCount} · {t('duplicates')}{' '}
              {i.duplicateCount}
              {pendingOf(i) > 0 && (
                <>
                  {' · '}
                  <Badge tone="warning" size="sm">
                    {t('pending')} {pendingOf(i)}
                  </Badge>
                </>
              )}
            </p>
          </Card>
        ))}
      </ul>

      {/* md+: table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="text-start text-xs uppercase text-gray-500 dark:text-gray-400">
            <tr>
              <th className="px-2 py-1 text-start">{t('date')}</th>
              <th className="px-2 py-1 text-start">{t('source')}</th>
              <th className="px-2 py-1 text-start">{t('file')}</th>
              <th className="px-2 py-1 text-end">{t('rows')}</th>
              <th className="px-2 py-1 text-end">{t('inserted')}</th>
              <th className="px-2 py-1 text-end">{t('duplicates')}</th>
              <th className="px-2 py-1 text-end">{t('pending')}</th>
              <th className="px-2 py-1 text-end">{t('balance')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {imports.map((i) => (
              <tr
                key={i.id}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60"
                onClick={() => onSelect(i.id)}
                data-testid={`import-row-${i.id}`}
              >
                <td className="px-2 py-2">{formatOccurredDate(i.createdAt, locale)}</td>
                <td className="px-2 py-2">
                  <Badge tone="neutral">{sourceLabel(i.source)}</Badge>
                </td>
                <td
                  dir="ltr"
                  className="max-w-[16rem] truncate px-2 py-2 text-start text-xs text-gray-500 dark:text-gray-400"
                >
                  {i.originalName ?? ''}
                </td>
                <td
                  className="px-2 py-2 text-end font-mono"
                  data-testid={`import-row-counts-${i.id}`}
                >
                  {i.totalCount}
                </td>
                <td className="px-2 py-2 text-end font-mono">{i.insertedCount}</td>
                <td className="px-2 py-2 text-end font-mono">{i.duplicateCount}</td>
                <td className="px-2 py-2 text-end font-mono">{pendingOf(i)}</td>
                <td className="px-2 py-2 text-end font-mono">
                  {typeof i.statementBalanceCents === 'number'
                    ? formatAmount(i.statementBalanceCents, currency, locale)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={onLoadMore}
          >
            {tReview('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
