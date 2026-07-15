'use client';

// Phase 6 · Iteration 6.13 — category <select> with optgroups (System /
// Personal / per-group). Reusable across the form dialog and future
// recurring / installment forms (6.18 / 6.20).
// Phase 6 · Iteration 6.16.4 — self-fetch migrated to
// useAsyncOperation({ scope: 'container' }) for DRY compliance.

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useGroups } from '@/lib/group/group-context';
import { useTransactions } from '@/lib/transaction/transaction-context';
import type { CategoryDto } from '@/lib/transaction/types';
import { useAsyncOperation } from '@/lib/ui';

export interface TransactionCategoryPickerProps {
  direction: 'IN' | 'OUT';
  value: string | null;
  onChange(categoryId: string): void;
  /** When provided, used instead of fetching. */
  categories?: CategoryDto[] | null;
  disabled?: boolean;
  /** Optional data-testid override */
  testId?: string;
}

// Minimal private emoji map — a few known keys, unknown → no emoji.
const ICON_EMOJI: Record<string, string> = {
  'shopping-cart': '🛒',
  home: '🏠',
  food: '🍔',
  transport: '🚗',
  salary: '💰',
  health: '🩺',
  travel: '✈️',
  entertainment: '🎬',
  utilities: '💡',
  education: '🎓',
  gift: '🎁',
  rent: '🏠',
  groceries: '🛒',
  car: '🚗',
};

function iconFor(icon: string | null): string {
  if (!icon) return '';
  return ICON_EMOJI[icon] ?? '';
}

interface Grouped {
  system: CategoryDto[];
  personal: CategoryDto[];
  byGroup: Map<string, CategoryDto[]>;
}

function groupBy(cats: CategoryDto[]): Grouped {
  const system: CategoryDto[] = [];
  const personal: CategoryDto[] = [];
  const byGroup = new Map<string, CategoryDto[]>();
  for (const c of cats) {
    if (c.ownerType === 'system') system.push(c);
    else if (c.ownerType === 'user') personal.push(c);
    else if (c.ownerType === 'group') {
      const key = c.ownerId ?? 'unknown';
      const arr = byGroup.get(key) ?? [];
      arr.push(c);
      byGroup.set(key, arr);
    }
  }
  return { system, personal, byGroup };
}

function filterByDirection(cats: CategoryDto[], direction: 'IN' | 'OUT'): CategoryDto[] {
  return cats.filter((c) => c.direction === direction || c.direction === 'BOTH');
}

export function TransactionCategoryPicker({
  direction,
  value,
  onChange,
  categories: categoriesProp,
  disabled,
  testId,
}: TransactionCategoryPickerProps) {
  const t = useTranslations('transactions.categoryPicker');
  const { groups } = useGroups();
  const { listCategories } = useTransactions();

  const fetchOp = useAsyncOperation<CategoryDto[]>({ scope: 'container' });
  const useOwn = categoriesProp === undefined || categoriesProp === null;
  const loading = fetchOp.isLoading;
  const error = fetchOp.isError ? (fetchOp.error?.message ?? 'Failed') : null;

  useEffect(() => {
    if (!useOwn) return;
    void fetchOp.run((signal) => listCategories({ direction }, signal));
    // fetchOp identity is stable across renders.
  }, [useOwn, direction, listCategories]);

  const categories = useOwn ? (fetchOp.data ?? null) : categoriesProp;
  const filtered = categories ? filterByDirection(categories, direction) : null;
  const grouped = filtered ? groupBy(filtered) : null;

  const renderOption = (c: CategoryDto) => {
    const emoji = iconFor(c.icon);
    const prefix = emoji ? `${emoji} ` : '';
    const bothSuffix = c.direction === 'BOTH' ? ` ${t('bothBadge')}` : '';
    return (
      <option key={c.id} value={c.id}>
        {`${prefix}${c.name}${bothSuffix}`}
      </option>
    );
  };

  return (
    <div data-testid={testId ?? 'transaction-category-picker'}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading}
        data-testid="category-picker-select"
        aria-busy={loading}
        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      >
        <option value="" disabled>
          {loading ? t('loading') : t('placeholder')}
        </option>
        {grouped && grouped.system.length > 0 && (
          <optgroup label={t('groupSystem')}>{grouped.system.map(renderOption)}</optgroup>
        )}
        {grouped && grouped.personal.length > 0 && (
          <optgroup label={t('groupPersonal')}>{grouped.personal.map(renderOption)}</optgroup>
        )}
        {grouped &&
          Array.from(grouped.byGroup.entries()).map(([groupId, list]) => {
            const g = groups.find((x) => x.id === groupId);
            const label = t('groupGroup', { name: g?.name ?? groupId });
            return (
              <optgroup key={groupId} label={label}>
                {list.map(renderOption)}
              </optgroup>
            );
          })}
      </select>
      {error && (
        <p
          className="mt-1 text-xs text-red-600 dark:text-red-400"
          role="alert"
          data-testid="category-picker-error"
        >
          {t('errorLoading', { message: error })}
        </p>
      )}
    </div>
  );
}
