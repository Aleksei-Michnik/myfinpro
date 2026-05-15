'use client';

// Phase 6 · Iteration 6.16 — create / edit category dialog.
// Phase 6 · Iteration 6.16.4 — save flow migrated to
// useAsyncOperation({ scope: 'control' }). Save button shows
// <ButtonSpinner>; inputs disabled + aria-busy on the form. Cancel
// triggers cancel(). Domain errors (CATEGORY_SLUG_CONFLICT) still map
// to the per-field name error. Network/timeout/HTTP failures shown via
// the inline error banner with Retry.

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useCategories } from '@/lib/category/category-context';
import type { CategoryApiError, CategoryDto } from '@/lib/category/types';
import { useAsyncOperation } from '@/lib/ui';

export type CategoryFormScope = { type: 'personal' } | { type: 'group'; groupId: string };

export interface CategoryFormDialogProps {
  mode: 'create' | 'edit';
  scope: CategoryFormScope;
  /** Required in 'edit' mode; ignored in 'create'. */
  category?: CategoryDto;
  open: boolean;
  onClose(): void;
  onSaved(category: CategoryDto): void;
}

const PRESET_COLORS = [
  '#7c3aed',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#ec4899',
  '#6b7280',
  '#0ea5e9',
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function CategoryFormDialog({
  mode,
  scope,
  category,
  open,
  onClose,
  onSaved,
}: CategoryFormDialogProps) {
  const t = useTranslations('categories.form');
  const { create, update } = useCategories();

  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '');
  const [color, setColor] = useState(category?.color ?? '');
  const [direction, setDirection] = useState<'IN' | 'OUT' | 'BOTH'>(category?.direction ?? 'BOTH');
  const [errors, setErrors] = useState<{ name?: string; color?: string }>({});

  const saveOp = useAsyncOperation<CategoryDto>({ scope: 'control' });
  const isLoading = saveOp.isLoading;

  // Reset on `open` toggle / category change.
  useEffect(() => {
    if (!open) {
      saveOp.cancel();
      return;
    }
    setName(category?.name ?? '');
    setIcon(category?.icon ?? '');
    setColor(category?.color ?? '');
    setDirection(category?.direction ?? 'BOTH');
    setErrors({});
    saveOp.reset();
  }, [open, category]);

  if (!open) return null;

  const validate = (): boolean => {
    const nextErr: typeof errors = {};
    if (!name.trim()) nextErr.name = t('errors.nameRequired');
    else if (name.length > 60) nextErr.name = t('errors.nameTooLong');
    if (color && !HEX_RE.test(color)) nextErr.color = t('errors.colorInvalid');
    setErrors(nextErr);
    return Object.keys(nextErr).length === 0;
  };

  const runSave = () => {
    if (!validate()) return;
    void saveOp
      .run(async (signal) => {
        try {
          if (mode === 'create') {
            return await create(
              {
                name: name.trim(),
                scope: scope.type,
                groupId: scope.type === 'group' ? scope.groupId : undefined,
                direction,
                icon: icon.trim() || undefined,
                color: color.trim() || undefined,
              },
              signal,
            );
          }
          if (!category) throw new Error('Missing category');
          return await update(
            category.id,
            {
              name: name.trim(),
              icon: icon.trim() || undefined,
              color: color.trim() || undefined,
              direction,
            },
            signal,
          );
        } catch (e) {
          const err = e as CategoryApiError;
          if (err.errorCode === 'CATEGORY_SLUG_CONFLICT') {
            setErrors({ name: t('errors.duplicate') });
            // Treat as a domain error; suppress the inline banner by
            // landing in 'aborted'.
            throw new DOMException('domain', 'AbortError');
          }
          throw e;
        }
      })
      .then((created) => {
        if (!created) return;
        onSaved(created);
        onClose();
      });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSave();
  };

  const handleCancel = () => {
    saveOp.cancel();
    onClose();
  };

  const showBanner = saveOp.isError && saveOp.error !== null && saveOp.error.reason !== 'aborted';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-form-dialog-title"
      data-testid="category-form-dialog"
    >
      <form
        onSubmit={handleSubmit}
        aria-busy={isLoading || undefined}
        className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
      >
        <h2
          id="category-form-dialog-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {t(`title.${mode}`)}
        </h2>

        {/* Name */}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('name.label')}
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('name.placeholder')}
            maxLength={100}
            disabled={isLoading}
            data-testid="category-form-name"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
          {errors.name && (
            <p className="mt-1 text-xs text-red-600" data-testid="category-form-name-error">
              {errors.name}
            </p>
          )}
        </label>

        {/* Icon */}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('icon.label')}
          </span>
          <input
            type="text"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder={t('icon.placeholder')}
            maxLength={4}
            disabled={isLoading}
            data-testid="category-form-icon"
            className="w-24 rounded-md border border-gray-300 bg-white px-3 py-2 text-center text-base text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
        </label>

        {/* Direction */}
        <fieldset disabled={isLoading}>
          <legend className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('direction.label')}
          </legend>
          <div className="flex gap-2" role="radiogroup">
            {(['IN', 'OUT', 'BOTH'] as const).map((d) => (
              <label
                key={d}
                className={`flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm ${
                  direction === d
                    ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
                    : 'border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="direction"
                  value={d}
                  checked={direction === d}
                  onChange={() => setDirection(d)}
                  disabled={isLoading}
                  data-testid={`category-form-direction-${d}`}
                  className="sr-only"
                />
                {t(`direction.${d === 'IN' ? 'in' : d === 'OUT' ? 'out' : 'both'}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Color */}
        <div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('color.label')}
            </span>
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder={t('color.placeholder')}
              maxLength={7}
              disabled={isLoading}
              data-testid="category-form-color"
              className="w-32 rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </label>
          {errors.color && (
            <p className="mt-1 text-xs text-red-600" data-testid="category-form-color-error">
              {errors.color}
            </p>
          )}
          <div className="mt-2">
            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
              {t('color.presetsLabel')}
            </span>
            <div className="flex flex-wrap gap-2" role="group">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  disabled={isLoading}
                  aria-label={c}
                  data-testid={`category-form-preset-${c}`}
                  className={`h-7 w-7 rounded-full border-2 ${
                    color.toLowerCase() === c.toLowerCase()
                      ? 'border-gray-900 dark:border-gray-100'
                      : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        {showBanner && saveOp.error && (
          <div data-testid="category-form-generic-error">
            <InlineErrorBanner
              reason={saveOp.error.reason}
              httpStatus={saveOp.error.httpStatus}
              message={t('errors.generic', { message: saveOp.error.message ?? '' })}
              onRetry={() => void saveOp.retry()}
              retrying={isLoading}
              data-testid="category-form-error-banner"
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleCancel}
            data-testid="category-form-cancel"
          >
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={isLoading}
            aria-busy={isLoading}
            data-testid="category-form-submit"
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <ButtonSpinner />
                <span>{t('saving')}</span>
              </span>
            ) : (
              t('save')
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
