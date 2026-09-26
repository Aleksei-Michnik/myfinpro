'use client';

// Phase 6 · Iteration 6.13 — multi-select checkbox list used by the transaction
// form dialog to choose which attribution scopes a transaction belongs to.
//
// Controlled component. Validation (at least one scope) is enforced by the
// parent — this component only emits the next value.

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Checkbox } from '@/components/ui/Checkbox';
import { useGroups } from '@/lib/group/group-context';
import type { AttributionScope } from '@/lib/transaction/types';

export interface TransactionScopeSelectorProps {
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

export function TransactionScopeSelector({
  value,
  onChange,
  hidePersonal,
  allowedGroupIds,
  disabled,
}: TransactionScopeSelectorProps) {
  const t = useTranslations('transactions.scopeSelector');
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
      data-testid="transaction-scope-selector"
    >
      {!hidePersonal && (
        <Checkbox
          checked={hasPersonal(value)}
          onChange={togglePersonal}
          disabled={disabled}
          data-testid="scope-toggle-personal"
          align="center"
          label={t('personal')}
        />
      )}

      {visibleGroups.map((g) => {
        const role = (g.role ?? '').toLowerCase();
        const roleLabel = role === 'admin' ? t('groupRole.admin') : null;
        return (
          <Checkbox
            key={g.id}
            checked={hasGroup(value, g.id)}
            onChange={() => toggleGroup(g.id)}
            disabled={disabled}
            data-testid={`scope-toggle-group-${g.id}`}
            align="center"
            label={
              <span className="inline-flex items-center gap-2">
                <span>{g.name}</span>
                {roleLabel && (
                  <Badge tone="primary" data-testid={`scope-group-role-${g.id}`}>
                    {roleLabel}
                  </Badge>
                )}
              </span>
            }
          />
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
