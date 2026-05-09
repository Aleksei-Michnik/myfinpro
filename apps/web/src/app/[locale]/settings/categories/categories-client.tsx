'use client';

// Phase 6 · Iteration 6.16 — Settings → Categories management.
// Personal section is always rendered first; one section per group the user
// is a member of. Each section uses <CategoryListSection>.

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { CategoryListSection } from '@/components/category/CategoryListSection';
import { useCategories } from '@/lib/category/category-context';
import { useGroups } from '@/lib/group/group-context';

export function CategoriesClient() {
  const t = useTranslations('categories');
  const tScope = useTranslations('categories.scope');
  const { fetchAll, systemCategories, personalCategories, groupCategories, isLoading } =
    useCategories();
  const { groups } = useGroups();

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-8" data-testid="categories-page">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('page.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('page.subtitle')}</p>
      </header>

      <CategoryListSection
        title={tScope('personal')}
        scope={{ type: 'personal' }}
        systemCategories={systemCategories()}
        customCategories={personalCategories()}
        loading={isLoading && personalCategories().length === 0}
      />

      {groups.map((g) => (
        <CategoryListSection
          key={g.id}
          title={tScope('groupHeading', { group: g.name })}
          scope={{ type: 'group', groupId: g.id }}
          customCategories={groupCategories(g.id)}
          loading={isLoading && groupCategories(g.id).length === 0}
        />
      ))}
    </main>
  );
}
