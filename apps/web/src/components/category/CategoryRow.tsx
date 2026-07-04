'use client';

// Phase 6 · Iteration 6.16 — single category row inside a CategoryListSection.
// System categories show a "Default" badge and have no actions. Custom rows
// expose Edit / Delete via the shared <RowActionsMenu>.

import { useTranslations } from 'next-intl';
import { RowActionsMenu } from '@/components/ui/RowActionsMenu';
import type { CategoryDto } from '@/lib/category/types';

export interface CategoryRowProps {
  category: CategoryDto;
  onEdit?(category: CategoryDto): void;
  onDelete?(category: CategoryDto): void;
}

const DIRECTION_LABEL: Record<'IN' | 'OUT' | 'BOTH', string> = {
  IN: 'in',
  OUT: 'out',
  BOTH: 'both',
};

export function CategoryRow({ category, onEdit, onDelete }: CategoryRowProps) {
  const t = useTranslations('categories');
  const tDir = useTranslations('categories.form.direction');
  const isCustom = !category.isSystem && category.ownerType !== 'system';

  return (
    <li
      className="flex items-center justify-between gap-3 border-b border-gray-200 py-2 last:border-b-0 dark:border-gray-700"
      data-testid={`category-row-${category.id}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-base"
          style={{
            backgroundColor: category.color ?? '#e5e7eb',
            color: '#fff',
          }}
          data-testid={`category-row-icon-${category.id}`}
        >
          {category.icon ?? '•'}
        </span>
        <div className="min-w-0">
          <p
            className="truncate text-sm font-medium text-gray-900 dark:text-gray-100"
            data-testid={`category-row-name-${category.id}`}
          >
            {category.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {tDir(DIRECTION_LABEL[category.direction] as 'in' | 'out' | 'both')}
          </p>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {!isCustom && (
          <span
            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
            data-testid={`category-row-system-badge-${category.id}`}
            title={t('system.hint')}
          >
            {t('system.badge')}
          </span>
        )}
        {isCustom && (onEdit || onDelete) && (
          <RowActionsMenu
            triggerLabel={t('actions.edit')}
            testId={`category-row-actions-${category.id}`}
            items={[
              ...(onEdit
                ? [
                    {
                      key: 'edit',
                      label: t('actions.edit'),
                      onClick: () => onEdit(category),
                      testId: `category-row-edit-${category.id}`,
                    },
                  ]
                : []),
              ...(onDelete
                ? [
                    {
                      key: 'delete',
                      label: t('actions.delete'),
                      onClick: () => onDelete(category),
                      destructive: true,
                      testId: `category-row-delete-${category.id}`,
                    },
                  ]
                : []),
            ]}
          />
        )}
      </div>
    </li>
  );
}
