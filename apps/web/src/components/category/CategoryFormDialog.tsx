'use client';

// Phase 6 · Iteration 6.16 — create / edit category dialog.

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useCategories } from '@/lib/category/category-context';
import type { CategoryApiError, CategoryDto } from '@/lib/category/types';

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
  const [errors, setErrors] = useState<{ name?: string; color?: string; generic?: string }>({});
  const [saving, setSaving] = useState(false);

  // Reset on `open` toggle / category change.
  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setIcon(category?.icon ?? '');
    setColor(category?.color ?? '');
    setDirection(category?.direction ?? 'BOTH');
    setErrors({});
    setSaving(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      if (mode === 'create') {
        const created = await create({
          name: name.trim(),
          scope: scope.type,
          groupId: scope.type === 'group' ? scope.groupId : undefined,
          direction,
          icon: icon.trim() || undefined,
          color: color.trim() || undefined,
        });
        onSaved(created);
      } else if (category) {
        const updated = await update(category.id, {
          name: name.trim(),
          icon: icon.trim() || undefined,
          color: color.trim() || undefined,
          direction,
        });
        onSaved(updated);
      }
      onClose();
    } catch (e) {
      const err = e as CategoryApiError;
      if (err.errorCode === 'CATEGORY_SLUG_CONFLICT') {
        setErrors({ name: t('errors.duplicate') });
      } else {
        setErrors({ generic: t('errors.generic', { message: err.message || '' }) });
      }
      setSaving(false);
    }
  };

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
            disabled={saving}
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
            disabled={saving}
            data-testid="category-form-icon"
            className="w-24 rounded-md border border-gray-300 bg-white px-3 py-2 text-center text-base text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
        </label>

        {/* Direction */}
        <fieldset>
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
                  disabled={saving}
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
              disabled={saving}
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
                  disabled={saving}
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

        {errors.generic && (
          <p className="text-sm text-red-600" data-testid="category-form-generic-error">
            {errors.generic}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={saving}
            data-testid="category-form-cancel"
          >
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={saving}
            data-testid="category-form-submit"
          >
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
