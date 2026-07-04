'use client';

// Phase 6 · Iteration 6.16 — Delete category confirmation dialog.
// Phase 6 · Iteration 6.16.4 — single useAsyncOperation({ scope: 'control' })
// drives both attempts of the two-step CATEGORY_IN_USE flow:
//   1) first run: try plain delete; on 409 CATEGORY_IN_USE, surface the
//      replacement-category select and re-run with replaceWithCategoryId.
//   2) second run: success → close. The CATEGORY_IN_USE branch is treated
//      as a domain error (no inline banner), other failures use the banner.

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useCategories } from '@/lib/category/category-context';
import type { CategoryApiError, CategoryDto, DeleteCategoryResult } from '@/lib/category/types';
import { useAsyncOperation } from '@/lib/ui';

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

  const deleteOp = useAsyncOperation<DeleteCategoryResult>({ scope: 'control' });
  const isLoading = deleteOp.isLoading;

  // Filter compatible candidates by direction.
  const compatibleCandidates = useMemo(() => {
    return candidates.filter(
      (c) => c.id !== category.id && (c.direction === category.direction || c.direction === 'BOTH'),
    );
  }, [candidates, category]);

  if (!open) return null;

  const runDelete = () => {
    void deleteOp
      .run(async (signal) => {
        try {
          return await remove(
            category.id,
            replaceWithId ? { replaceWithCategoryId: replaceWithId } : {},
            signal,
          );
        } catch (e) {
          const err = e as CategoryApiError;
          if (err.errorCode === 'CATEGORY_IN_USE') {
            setUsage(err.details?.usage ?? 1);
            // Domain error — treat as aborted to suppress the inline banner.
            throw new DOMException('domain', 'AbortError');
          }
          throw e;
        }
      })
      .then((result) => {
        if (!result) return;
        onDeleted();
        onClose();
      });
  };

  const handleCancel = () => {
    deleteOp.cancel();
    onClose();
  };

  const showBanner =
    deleteOp.isError && deleteOp.error !== null && deleteOp.error.reason !== 'aborted';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-category-title"
      data-testid="delete-category-dialog"
      aria-busy={isLoading || undefined}
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
                disabled={isLoading}
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

        {showBanner && deleteOp.error && (
          <div data-testid="delete-category-error">
            <InlineErrorBanner
              reason={deleteOp.error.reason}
              httpStatus={deleteOp.error.httpStatus}
              message={t('errorGeneric', { message: deleteOp.error.message ?? '' })}
              onRetry={() => void deleteOp.retry()}
              retrying={isLoading}
              data-testid="delete-category-error-banner"
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleCancel}
            data-testid="delete-category-cancel"
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={runDelete}
            disabled={isLoading || (usage !== null && !replaceWithId)}
            aria-busy={isLoading}
            className="!bg-red-600 hover:!bg-red-700 focus:!ring-red-500"
            data-testid="delete-category-confirm"
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <ButtonSpinner />
                <span>{t('deleting')}</span>
              </span>
            ) : (
              t('confirm')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
