'use client';

// Phase 6 · Iteration 6.16 — horizontal scope-tab strip for the /transactions page.
// Phase 6 · Iteration 6.16.2 — converted from <Link>-based tabs to controlled
// <button> tabs. The orchestrator owns URL writes (only emitted on commit).
// Phase 20 · Iteration 20.1 — a thin wrapper that builds the items for the
// kit's <Tabs>; the strip itself lives in components/ui/Tabs.tsx.

import { useTranslations } from 'next-intl';
import { Tabs } from '@/components/ui/Tabs';

export interface TransactionsScopeTabsProps {
  /** `'all'` | `'personal'` | `'group:<id>'`. */
  current: string;
  groups: { id: string; name: string }[];
  /** Called with the new scope key. The orchestrator writes the URL. */
  onChange(scope: string): void;
  /** When true, every tab is disabled (visually + aria-disabled + click guarded). */
  disabled?: boolean;
}

export function TransactionsScopeTabs({
  current,
  groups,
  onChange,
  disabled,
}: TransactionsScopeTabsProps) {
  const t = useTranslations('transactions.page.scopeTabs');

  const items = [
    { key: 'all', label: t('all'), testId: 'scope-tab-all' },
    { key: 'personal', label: t('personal'), testId: 'scope-tab-personal' },
    ...groups.map((g) => ({
      key: `group:${g.id}`,
      label: g.name,
      testId: `scope-tab-group:${g.id}`,
    })),
  ];

  return (
    <Tabs
      items={items}
      current={current}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={t('all')}
      data-testid="transactions-scope-tabs"
    />
  );
}
