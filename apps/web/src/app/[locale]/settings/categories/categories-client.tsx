'use client';

// Phase 6 · Iteration 6.16 — Settings → Categories management.
// Phase 6 · Iteration 6.16.4 — initial fetch migrated to
// useAsyncOperation({ scope: 'page' }). The top <PageProgressBar>
// continues showing past the route change until the data lands. On
// failure, opens <RetryReturnDialog>; Return navigates back to the
// settings index.

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { CategoryListSection } from '@/components/category/CategoryListSection';
import { RetryReturnDialog } from '@/components/ui/RetryReturnDialog';
import { useRouter } from '@/i18n/navigation';
import { useCategories } from '@/lib/category/category-context';
import type { CategoryDto } from '@/lib/category/types';
import { useGroups } from '@/lib/group/group-context';
import { useAsyncOperation, useResetOnLocaleChange } from '@/lib/ui';

export function CategoriesClient() {
  const t = useTranslations('categories');
  const tScope = useTranslations('categories.scope');
  const router = useRouter();
  const { fetchAll, systemCategories, personalCategories, groupCategories } = useCategories();
  const { groups } = useGroups();

  const loadOp = useAsyncOperation<CategoryDto[]>({ scope: 'page' });

  // Mount-only initial fetch. Re-running is exposed via the RetryReturnDialog.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void loadOp.run((signal) => fetchAll(signal));
  }, []);

  // Phase 6 · Iteration 6.16.5 — re-fetch + clear errors on locale flip.
  useResetOnLocaleChange(() => {
    void loadOp.run((signal) => fetchAll(signal));
  });

  const isInitialLoading = loadOp.isLoading && loadOp.data === undefined;
  const showInitialError = loadOp.isError && loadOp.data === undefined;

  return (
    <main
      className="container mx-auto max-w-3xl space-y-6 px-4 py-8"
      data-testid="categories-page"
      aria-busy={isInitialLoading || undefined}
    >
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('page.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('page.subtitle')}</p>
      </header>

      <CategoryListSection
        title={tScope('personal')}
        scope={{ type: 'personal' }}
        systemCategories={systemCategories()}
        customCategories={personalCategories()}
        loading={isInitialLoading}
      />

      {groups.map((g) => (
        <CategoryListSection
          key={g.id}
          title={tScope('groupHeading', { group: g.name })}
          scope={{ type: 'group', groupId: g.id }}
          customCategories={groupCategories(g.id)}
          loading={isInitialLoading}
        />
      ))}

      <RetryReturnDialog
        open={showInitialError}
        reason={loadOp.error?.reason ?? 'unknown'}
        httpStatus={loadOp.error?.httpStatus}
        onRetry={() => void loadOp.retry()}
        onReturn={() => {
          loadOp.cancel();
          router.replace('/settings/account');
        }}
      />
    </main>
  );
}
