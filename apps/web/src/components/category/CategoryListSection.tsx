'use client';

// Phase 6 · Iteration 6.16 — render one scope's categories in a section.
// System categories (read-only) at the top with a "Default" badge; custom
// categories below with edit/delete; "+ New category" CTA opens the form.

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CategoryFormDialog } from './CategoryFormDialog';
import { CategoryRow } from './CategoryRow';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';
import { Button } from '@/components/ui/Button';
import type { CategoryDto } from '@/lib/category/types';

export type SectionScope = { type: 'personal' } | { type: 'group'; groupId: string };

export interface CategoryListSectionProps {
  /** Section heading. */
  title: string;
  scope: SectionScope;
  systemCategories?: CategoryDto[];
  customCategories: CategoryDto[];
  /** Replacement candidates for delete-confirm dialog. */
  candidates?: CategoryDto[];
  /** When true, hides edit/delete + create CTA (e.g. for non-admins on group section). */
  readOnly?: boolean;
  loading?: boolean;
}

export function CategoryListSection({
  title,
  scope,
  systemCategories = [],
  customCategories,
  candidates,
  readOnly = false,
  loading = false,
}: CategoryListSectionProps) {
  const t = useTranslations('categories');

  const [editing, setEditing] = useState<CategoryDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CategoryDto | null>(null);

  const sectionTestId =
    scope.type === 'personal' ? 'category-section-personal' : `category-section-${scope.groupId}`;

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
      data-testid={sectionTestId}
      aria-label={title}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {!readOnly && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setCreating(true)}
            data-testid={`${sectionTestId}-create`}
          >
            {t('actions.create')}
          </Button>
        )}
      </header>

      {loading && (
        <p
          className="text-sm text-gray-500 dark:text-gray-400"
          data-testid={`${sectionTestId}-loading`}
        >
          {t('loading')}
        </p>
      )}

      {!loading && (
        <ul
          className="divide-y divide-gray-100 dark:divide-gray-700"
          data-testid={`${sectionTestId}-list`}
        >
          {systemCategories.map((c) => (
            <CategoryRow key={c.id} category={c} />
          ))}
          {customCategories.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              onEdit={readOnly ? undefined : setEditing}
              onDelete={readOnly ? undefined : setDeleting}
            />
          ))}
        </ul>
      )}

      {!loading && customCategories.length === 0 && systemCategories.length === 0 && (
        <p
          className="py-3 text-sm italic text-gray-500 dark:text-gray-400"
          data-testid={`${sectionTestId}-empty`}
        >
          {t('empty')}
        </p>
      )}

      {(creating || editing) && (
        <CategoryFormDialog
          open
          mode={editing ? 'edit' : 'create'}
          scope={scope}
          category={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <DeleteCategoryDialog
          category={deleting}
          candidates={candidates ?? customCategories}
          open
          onClose={() => setDeleting(null)}
          onDeleted={() => setDeleting(null)}
        />
      )}
    </section>
  );
}
