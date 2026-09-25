'use client';

// Phase 20 · Iteration 20.3 — THE account picker (design doc §7, UI spec §3).
// Wraps the kit <Select>; self-fetches when no `accounts` prop is given
// (the `TransactionCategoryPicker` pattern: LoadingOverlay + InlineErrorBanner
// with Retry). Options are grouped by scope — Personal, then one optgroup
// per group — mirroring the transaction scope selector's ordering.

import { useTranslations } from 'next-intl';
import { useEffect, useMemo } from 'react';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { Select } from '@/components/ui/Select';
import { useOptionalAccounts } from '@/lib/account/account-context';
import { INSTITUTION_META, type AccountKind, type AccountSummary } from '@/lib/account/types';
import { useGroups } from '@/lib/group/group-context';
import { formatScopeLabel } from '@/lib/transaction/formatters';
import type { AttributionScope } from '@/lib/transaction/types';
import { useAsyncOperation } from '@/lib/ui';

export interface AccountSelectProps {
  /** Selected account id; `''` from the native `<select>` maps to `onChange(null)`. */
  value: string | null;
  onChange(id: string | null): void;
  /** Only accounts denominated in this currency are listed (design §6.3). */
  currency?: string;
  /** e.g. `['BANK']` for the billing-account picker. */
  kinds?: AccountKind[];
  /** Restrict to one scope (billing account, line-decision defaults). */
  scope?: AttributionScope;
  /** The transfer source excludes itself from the destination list. */
  excludeIds?: string[];
  /** An archived account already set stays listed (marked); default false. */
  includeArchived?: boolean;
  emptyOptionLabel?: string;
  /** Pre-fetched list — when provided, the component never self-fetches. */
  accounts?: AccountSummary[] | null;
  disabled?: boolean;
  testId?: string;
  label?: string;
  error?: string;
  /** Forwarded to the kit `Select`. */
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}

function scopeKey(a: Pick<AccountSummary, 'scopeType' | 'groupId'>): string {
  return a.scopeType === 'personal' ? 'personal' : `group:${a.groupId}`;
}

export function AccountSelect({
  value,
  onChange,
  currency,
  kinds,
  scope,
  excludeIds,
  includeArchived = false,
  emptyOptionLabel,
  accounts: accountsProp,
  disabled,
  testId,
  label,
  error,
  size = 'sm',
  fullWidth = true,
}: AccountSelectProps) {
  const t = useTranslations('accounts.select');
  // The scope-chip label text lives with the other scope labels (one owner
  // per string, DRY) — same reuse as `BudgetCard`.
  const tTransactions = useTranslations('transactions');
  const { groups } = useGroups();
  // Without a provider (isolated specs) the picker renders empty and never fetches.
  const fetchAccounts = useOptionalAccounts()?.fetchAccounts;

  const fetchOp = useAsyncOperation<AccountSummary[]>({
    scope: 'container',
    id: `account-select-fetch-${testId ?? 'default'}`,
  });
  const useOwn = (accountsProp === undefined || accountsProp === null) && !!fetchAccounts;

  useEffect(() => {
    if (!useOwn || !fetchAccounts) return;
    void fetchOp.run(async (signal) => {
      const res = await fetchAccounts({ scope: 'all', includeArchived: true, limit: 100 }, signal);
      return res.data;
    });
    // fetchOp / fetchAccounts identities are stable across renders.
  }, [useOwn, fetchAccounts]);

  const allAccounts = useOwn ? (fetchOp.data ?? null) : (accountsProp ?? []);

  const filtered = useMemo(() => {
    if (!allAccounts) return null;
    const excludeSet = new Set(excludeIds ?? []);
    return allAccounts.filter((a) => {
      if (excludeSet.has(a.id)) return false;
      if (currency && a.currency !== currency) return false;
      if (kinds && !kinds.includes(a.kind)) return false;
      if (scope) {
        if (scope.scope === 'personal' && a.scopeType !== 'personal') return false;
        if (scope.scope === 'group' && (a.scopeType !== 'group' || a.groupId !== scope.groupId)) {
          return false;
        }
      }
      // An archived account already selected stays visible (marked), even
      // when includeArchived is off.
      if (a.archivedAt && !includeArchived && a.id !== value) return false;
      return true;
    });
  }, [allAccounts, currency, kinds, scope, excludeIds, includeArchived, value]);

  const grouped = useMemo(() => {
    if (!filtered) return null;
    const byScope = new Map<string, AccountSummary[]>();
    for (const a of filtered) {
      const key = scopeKey(a);
      const arr = byScope.get(key) ?? [];
      arr.push(a);
      byScope.set(key, arr);
    }
    return byScope;
  }, [filtered]);

  const loading = useOwn && fetchOp.isLoading;
  const loadError = useOwn && fetchOp.isError ? fetchOp.error : null;

  const renderOption = (a: AccountSummary) => {
    // Institution is a proper noun — never translated (design §0 "Labels").
    const institutionName = a.institution
      ? INSTITUTION_META[a.institution as keyof typeof INSTITUTION_META]?.name
      : undefined;
    const parts = [a.name, institutionName].filter(Boolean).join(' · ');
    const last4 = a.last4 ? ` · ·· ${a.last4}` : '';
    const archivedSuffix = a.archivedAt ? ` ${t('archivedSuffix')}` : '';
    return (
      <option key={a.id} value={a.id}>
        {`${parts}${last4}${archivedSuffix}`}
      </option>
    );
  };

  const personalAccounts = grouped?.get('personal') ?? [];
  const groupEntries = grouped
    ? Array.from(grouped.entries()).filter(([key]) => key !== 'personal')
    : [];

  return (
    <div className="relative" data-testid={testId ? `${testId}-wrapper` : 'account-select-wrapper'}>
      <Select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || loading}
        aria-busy={loading}
        data-testid={testId ?? 'account-select'}
        label={label}
        error={error}
        size={size}
        fullWidth={fullWidth}
      >
        <option value="">{loading ? t('loading') : (emptyOptionLabel ?? t('unplaced'))}</option>
        {personalAccounts.length > 0 && (
          <optgroup label={formatScopeLabel({ scope: 'personal', groupName: null }, tTransactions)}>
            {personalAccounts.map(renderOption)}
          </optgroup>
        )}
        {groupEntries.map(([key, list]) => {
          const groupId = key.slice('group:'.length);
          const g = groups.find((x) => x.id === groupId);
          const label = formatScopeLabel(
            { scope: 'group', groupName: g?.name ?? null },
            tTransactions,
          );
          return (
            <optgroup key={key} label={label}>
              {list.map(renderOption)}
            </optgroup>
          );
        })}
      </Select>
      <LoadingOverlay active={loading} data-testid="account-select-loading" />
      {loadError && (
        <InlineErrorBanner
          className="mt-1"
          reason={loadError.reason}
          httpStatus={loadError.httpStatus}
          message={t('errorLoading', { message: loadError.message ?? '' })}
          onRetry={() => void fetchOp.retry()}
          retrying={fetchOp.isLoading}
          data-testid="account-select-error"
        />
      )}
    </div>
  );
}
