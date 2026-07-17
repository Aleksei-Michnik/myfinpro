'use client';

// Phase 10 · Iteration 10.3 — deliberately minimal /budgets page: header +
// "New budget" button + a plain list of budget names, so the create dialog
// is reachable and deployable. The full cards/filters/archived-toggle page
// (with edit/delete/archive flows) lands in 10.4 (design §7).

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { CreateBudgetDialog } from '@/components/budget/CreateBudgetDialog';
import { Button } from '@/components/ui/Button';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useBudgets } from '@/lib/budget/budget-context';
import type { BudgetSummary } from '@/lib/budget/types';
import { useAsyncOperation } from '@/lib/ui';

export function BudgetsClient() {
  const t = useTranslations('budgets.list');
  const { fetchBudgets } = useBudgets();

  const [budgets, setBudgets] = useState<BudgetSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  const listOp = useAsyncOperation<BudgetSummary[]>({ scope: 'container' });

  const load = useCallback(() => {
    void listOp
      .run(async (signal) => (await fetchBudgets(undefined, signal)).data)
      .then((data) => {
        if (data !== undefined) setBudgets(data);
      });
    // listOp identity is stable (useAsyncOperation contract).
  }, [fetchBudgets]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="container mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setCreateOpen(true)}
          data-testid="budgets-new"
        >
          {t('newBudget')}
        </Button>
      </div>

      {listOp.error && listOp.error.reason !== 'aborted' ? (
        <InlineErrorBanner
          reason={listOp.error.reason}
          httpStatus={listOp.error.httpStatus}
          onRetry={load}
        />
      ) : listOp.isLoading && budgets.length === 0 ? (
        <div
          className="space-y-2"
          role="status"
          aria-label={t('loading')}
          data-testid="budgets-loading"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-lg bg-gray-100 motion-reduce:animate-none dark:bg-gray-800"
            />
          ))}
        </div>
      ) : budgets.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400"
          data-testid="budgets-empty"
        >
          {t('empty')}
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700" data-testid="budgets-list">
          {budgets.map((b) => (
            <li
              key={b.id}
              className="px-1 py-3 text-sm font-medium text-gray-900 dark:text-gray-100"
            >
              {b.name}
            </li>
          ))}
        </ul>
      )}

      <CreateBudgetDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />
    </main>
  );
}
