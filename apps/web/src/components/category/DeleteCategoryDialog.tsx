'use client';

// Phase 6 · Iteration 6.16 — Delete category confirmation dialog.
// The API rejects deletion of an in-use category unless `replaceWithCategoryId`
// is provided, so the dialog supports a two-step flow: first attempt simple
// delete; on CATEGORY_IN_USE we surface a replacement-category select.

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useCategories } from '@/lib/category/category-context';
import type { CategoryApiError, CategoryDto } from '@/lib/category/types';

export interface DeleteCategoryDialogProps {
  category: CategoryDto;
  /** Other categories the user can pick as a replacement. */
  candidates: CategoryDto[];
  open: boolean;
  onClose(): void;
  onDeleted(): void;
}

export function DeleteCategoryDialog({
  category,
  candidates,
  open,
  onClose,
  onDeleted,
}: DeleteCategoryDialogProps) {
  const t = useTranslations('categories.delete');
  const { remove } = useCategories();

  const [replaceWithId, setReplaceWithId] = useState<string>('');
  const [usage, setUsage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Filter compatible candidates by direction.
  const compatibleCandidates = useMemo(() => {
    return candidates.filter(
      (c) => c.id !== category.id && (c.direction === category.direction || c.direction === 'BOTH'),
    );
  }, [candidates, category]);

  if (!open) return null;

  const handleConfirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await remove(category.id, replaceWithId ? { replaceWithCategoryId: replaceWithId } : {});
      onDeleted();
      onClose();
    } catch (e) {
      const err = e as CategoryApiError;
      if (err.errorCode === 'CATEGORY_IN_USE') {
        setUsage(err.details?.usage ?? 1);
      } else {
        setError(t('errorGeneric', { message: err.message || '' }));
      }
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-category-title"
      data-testid="delete-category-dialog"
    >
      <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h2
          id="delete-category-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {t('title')}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t('warning', { name: category.name })}
        </p>

        {usage !== null && (
          <div className="space-y-2">
            <p
              className="text-sm text-amber-700 dark:text-amber-300"
              data-testid="delete-category-in-use"
            >
              {t('inUse', { count: usage })}
            </p>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('replaceLabel')}
              </span>
              <select
                value={replaceWithId}
                onChange={(e) => setReplaceWithId(e.target.value)}
                disabled={deleting}
                data-testid="delete-category-replace-select"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">—</option>
                {compatibleCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600" data-testid="delete-category-error">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={deleting}
            data-testid="delete-category-cancel"
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleConfirm}
            disabled={deleting || (usage !== null && !replaceWithId)}
            className="!bg-red-600 hover:!bg-red-700 focus:!ring-red-500"
            data-testid="delete-category-confirm"
          >
            {deleting ? t('deleting') : t('confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
