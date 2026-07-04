'use client';

// Phase 6 · Iteration 6.13 — multi-select checkbox list used by the payment
// form dialog to choose which attribution scopes a payment belongs to.
//
// Controlled component. Validation (at least one scope) is enforced by the
// parent — this component only emits the next value.

import { useTranslations } from 'next-intl';
import { useGroups } from '@/lib/group/group-context';
import type { AttributionScope } from '@/lib/payment/types';

export interface PaymentScopeSelectorProps {
  value: AttributionScope[];
  onChange(next: AttributionScope[]): void;
  /** When true, "Personal" is hidden — used by group-only forms. */
  hidePersonal?: boolean;
  /** Optional restriction: only show these specific groups. */
  allowedGroupIds?: string[];
  disabled?: boolean;
}

function hasPersonal(scopes: AttributionScope[]): boolean {
  return scopes.some((s) => s.scope === 'personal');
}

function hasGroup(scopes: AttributionScope[], groupId: string): boolean {
  return scopes.some((s) => s.scope === 'group' && s.groupId === groupId);
}

export function PaymentScopeSelector({
  value,
  onChange,
  hidePersonal,
  allowedGroupIds,
  disabled,
}: PaymentScopeSelectorProps) {
  const t = useTranslations('payments.scopeSelector');
  const { groups } = useGroups();

  const visibleGroups = allowedGroupIds
    ? groups.filter((g) => allowedGroupIds.includes(g.id))
    : groups;

  const togglePersonal = () => {
    if (disabled) return;
    if (hasPersonal(value)) {
      onChange(value.filter((s) => s.scope !== 'personal'));
    } else {
      onChange([...value, { scope: 'personal' }]);
    }
  };

  const toggleGroup = (groupId: string) => {
    if (disabled) return;
    if (hasGroup(value, groupId)) {
      onChange(value.filter((s) => !(s.scope === 'group' && s.groupId === groupId)));
    } else {
      onChange([...value, { scope: 'group', groupId }]);
    }
  };

  const showNoGroups = !hidePersonal ? false : visibleGroups.length === 0;

  return (
    <div
      className="space-y-1 rounded-md border border-gray-200 p-2 dark:border-gray-700"
      data-testid="payment-scope-selector"
    >
      {!hidePersonal && (
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={hasPersonal(value)}
            onChange={togglePersonal}
            disabled={disabled}
            data-testid="scope-toggle-personal"
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span>{t('personal')}</span>
        </label>
      )}

      {visibleGroups.map((g) => {
        const role = (g.role ?? '').toLowerCase();
        const roleLabel = role === 'admin' ? t('groupRole.admin') : null;
        return (
          <label
            key={g.id}
            className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
          >
            <input
              type="checkbox"
              checked={hasGroup(value, g.id)}
              onChange={() => toggleGroup(g.id)}
              disabled={disabled}
              data-testid={`scope-toggle-group-${g.id}`}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span>{g.name}</span>
            {roleLabel && (
              <span
                className="rounded bg-primary-100 px-1.5 text-xs text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
                data-testid={`scope-group-role-${g.id}`}
              >
                {roleLabel}
              </span>
            )}
          </label>
        );
      })}

      {showNoGroups && (
        <p
          className="text-xs italic text-gray-500 dark:text-gray-400"
          data-testid="scope-selector-no-groups"
        >
          {t('noGroups')}
        </p>
      )}
    </div>
  );
}
