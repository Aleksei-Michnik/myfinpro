'use client';

// Phase 6 · Iteration 6.16 — orchestrator for /payments.
// Reads URL search params (`?scope=...`, `?starred=1`), renders the
// PaymentsScopeTabs + StarredFilterToggle + PaymentsList. Validates group
// scope membership client-side to avoid 403 noise.

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { PaymentsList } from '@/components/payment/PaymentsList';
import { PaymentsScopeTabs } from '@/components/payment/PaymentsScopeTabs';
import { StarredFilterToggle } from '@/components/payment/StarredFilterToggle';
import { Link, useRouter, usePathname } from '@/i18n/navigation';
import { useGroups } from '@/lib/group/group-context';

type ScopeFilter = 'all' | 'personal' | string;

export function PaymentsListClient() {
  const t = useTranslations('payments.page');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { groups } = useGroups();

  const rawScope = searchParams.get('scope');
  const starred = searchParams.get('starred') === '1';

  const scope: ScopeFilter = useMemo(() => {
    if (!rawScope || rawScope === 'all') return 'all';
    if (rawScope === 'personal') return 'personal';
    if (rawScope.startsWith('group:')) return rawScope;
    return 'all';
  }, [rawScope]);

  // Validate group scope membership before issuing API calls.
  const noAccess = useMemo(() => {
    if (!scope.startsWith('group:')) return false;
    const groupId = scope.slice('group:'.length);
    return !groups.some((g) => g.id === groupId);
  }, [scope, groups]);

  const setStarred = useCallback(
    (next: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set('starred', '1');
      else params.delete('starred');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams],
  );

  // Map UI scope → PaymentsList prop.
  const listScope = scope === 'all' ? 'all' : scope;

  return (
    <main className="container mx-auto space-y-4 px-4 py-6" data-testid="payments-page">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
      </header>

      <PaymentsScopeTabs current={scope} groups={groups} />

      {noAccess ? (
        <div
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
          data-testid="payments-page-no-access"
          role="alert"
        >
          <p>{t('scopeTabs.noAccess')}</p>
          <Link
            href="/dashboard"
            className="mt-2 inline-block text-sm font-medium text-primary-600 hover:underline"
            data-testid="payments-page-back-to-dashboard"
          >
            {t('scopeTabs.backToDashboard')}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <StarredFilterToggle starred={starred} onChange={setStarred} />
          </div>
          <PaymentsList
            scope={listScope}
            initialFilters={{ scope: listScope, starred, sort: 'date_desc' }}
            showFilters
            showControls
            showStar
          />
        </>
      )}
    </main>
  );
}
