'use client';

// Phase 6 · Iteration 6.16 — horizontal scope-tab strip for the /payments page.
// Tabs: All | Personal | <each group>. Active tab gets `aria-current="page"`.

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export interface PaymentsScopeTabsProps {
  /** `'all'` | `'personal'` | `'group:<id>'`. */
  current: string;
  groups: { id: string; name: string }[];
}

export function PaymentsScopeTabs({ current, groups }: PaymentsScopeTabsProps) {
  const t = useTranslations('payments.page.scopeTabs');

  const tabs: { key: string; label: string; href: string }[] = [
    { key: 'all', label: t('all'), href: '/payments' },
    { key: 'personal', label: t('personal'), href: '/payments?scope=personal' },
    ...groups.map((g) => ({
      key: `group:${g.id}`,
      label: g.name,
      href: `/payments?scope=group:${g.id}`,
    })),
  ];

  return (
    <div
      role="tablist"
      aria-label={t('all')}
      className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700"
      data-testid="payments-scope-tabs"
    >
      {tabs.map((tab) => {
        const isActive = current === tab.key;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            role="tab"
            aria-current={isActive ? 'page' : undefined}
            aria-selected={isActive}
            data-testid={`scope-tab-${tab.key}`}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
