'use client';

// Phase 6 · Iteration 6.15 — per-scope shortcut cards on the aggregated
// dashboard. Personal tile is always rendered first; one tile per group the
// caller is a member of. Quick totals are computed locally from the supplied
// `payments` (or fetched once on mount when omitted).

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { computeMonthRange } from './date-range';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useGroups } from '@/lib/group/group-context';
import type { GroupSummary } from '@/lib/group/types';
import { formatAmount } from '@/lib/payment/formatters';
import { usePayments } from '@/lib/payment/payment-context';
import type { PaymentSummary } from '@/lib/payment/types';

export interface ScopeEntryCardsProps {
  /** Pre-fetched payments to derive per-scope totals from. */
  payments?: PaymentSummary[];
  /** Override `useGroups()`. Mostly for testing. */
  groups?: Pick<GroupSummary, 'id' | 'name' | 'role'>[];
  fromIso?: string;
  toIso?: string;
}

interface ScopeBucket {
  /** `'personal'` or `'group:<id>'`. */
  key: string;
  inCents: number;
  outCents: number;
  /** Currency picked for display — first one encountered for the scope. */
  currency: string | null;
  /** Whether multiple currencies were seen for this scope. */
  mixedCurrencies: boolean;
}

const FETCH_LIMIT = 100;

function bucketsFromPayments(
  rows: PaymentSummary[],
  userId: string | null,
): Map<string, ScopeBucket> {
  const buckets = new Map<string, ScopeBucket>();
  for (const r of rows) {
    for (const a of r.attributions) {
      let key: string | null = null;
      if (a.scope === 'personal' && (a.userId === null || a.userId === userId)) {
        key = 'personal';
      } else if (a.scope === 'group' && a.groupId) {
        key = `group:${a.groupId}`;
      }
      if (!key) continue;
      const existing = buckets.get(key) ?? {
        key,
        inCents: 0,
        outCents: 0,
        currency: r.currency,
        mixedCurrencies: false,
      };
      if (existing.currency && existing.currency !== r.currency) {
        existing.mixedCurrencies = true;
      } else if (!existing.currency) {
        existing.currency = r.currency;
      }
      if (r.direction === 'IN') existing.inCents += r.amountCents;
      else existing.outCents += r.amountCents;
      buckets.set(key, existing);
    }
  }
  return buckets;
}

export function ScopeEntryCards({ payments, groups, fromIso, toIso }: ScopeEntryCardsProps) {
  const t = useTranslations('dashboard.scopes');
  // Iteration 6.16.3 — reuse `dashboard.totals.in/out/net` for the per-card
  // amount labels (DRY: same labels as <TotalsCard>; no `dashboard.scopes.in`
  // namespace exists). Phantom keys would render as raw "dashboard.scopes.in".
  const tTotals = useTranslations('dashboard.totals');
  const tRole = useTranslations('groups.role');
  const locale = useLocale();
  const { user } = useAuth();
  const groupCtx = useGroups();
  const { fetchList } = usePayments();
  const effectiveGroups = groups ?? groupCtx.groups;

  const range = useMemo(() => {
    if (fromIso && toIso) return { fromIso, toIso };
    const r = computeMonthRange();
    return { fromIso: fromIso ?? r.fromIso, toIso: toIso ?? r.toIso };
  }, [fromIso, toIso]);

  const externallyProvided = payments !== undefined;
  const [rows, setRows] = useState<PaymentSummary[]>(externallyProvided ? payments! : []);
  const [loading, setLoading] = useState(!externallyProvided);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchList({
        from: range.fromIso,
        to: range.toIso,
        limit: FETCH_LIMIT,
        sort: 'date_desc',
      });
      setRows(res.data);
    } catch {
      // Silent failure — totals just show "No activity yet".
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [fetchList, range.fromIso, range.toIso]);

  useEffect(() => {
    if (externallyProvided) {
      setRows(payments!);
      return;
    }
    void load();
  }, [externallyProvided, payments, load]);

  const buckets = useMemo(() => bucketsFromPayments(rows, user?.id ?? null), [rows, user?.id]);

  const personalBucket = buckets.get('personal');
  const fallbackCurrency = user?.defaultCurrency ?? 'USD';

  return (
    <section className="space-y-3" data-testid="scope-cards" aria-labelledby="scope-cards-title">
      <h2
        id="scope-cards-title"
        className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
      >
        {t('title')}
      </h2>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <li>
          <ScopeCard
            testId="scope-card-personal"
            href="/payments?scope=personal"
            title={t('personal')}
            subtitle={t('personalSubtitle')}
            bucket={personalBucket}
            fallbackCurrency={fallbackCurrency}
            locale={locale}
            t={t}
            tTotals={tTotals}
            loading={loading}
          />
        </li>
        {effectiveGroups.map((g) => {
          const bucket = buckets.get(`group:${g.id}`);
          const role = g.role ? tRole(g.role as 'admin' | 'member') : '';
          return (
            <li key={g.id}>
              <ScopeCard
                testId={`scope-card-group-${g.id}`}
                href={`/payments?scope=group:${g.id}`}
                title={g.name}
                subtitle={role || t('personalSubtitle')}
                roleBadge={role || null}
                bucket={bucket}
                fallbackCurrency={fallbackCurrency}
                locale={locale}
                t={t}
                tTotals={tTotals}
                loading={loading}
              />
            </li>
          );
        })}
      </ul>

      {effectiveGroups.length === 0 && !loading && (
        <p
          className="text-sm text-gray-500 dark:text-gray-400"
          data-testid="scope-cards-empty-groups"
        >
          {t('empty')}{' '}
          <Link href="/groups" className="text-primary-600 hover:underline">
            {t('createGroup')}
          </Link>
        </p>
      )}
    </section>
  );
}

interface ScopeCardProps {
  testId: string;
  href: string;
  title: string;
  subtitle: string;
  roleBadge?: string | null;
  bucket: ScopeBucket | undefined;
  fallbackCurrency: string;
  locale: string;
  t: (key: string) => string;
  tTotals: (key: string) => string;
  loading: boolean;
}

function ScopeCard({
  testId,
  href,
  title,
  subtitle,
  roleBadge,
  bucket,
  fallbackCurrency,
  locale,
  t,
  tTotals,
  loading,
}: ScopeCardProps) {
  const currency = bucket?.currency ?? fallbackCurrency;
  const hasActivity = !!bucket && (bucket.inCents > 0 || bucket.outCents > 0);
  const net = bucket ? bucket.inCents - bucket.outCents : 0;

  return (
    <article
      className="flex h-full flex-col justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-primary-400 dark:border-gray-700 dark:bg-gray-800"
      data-testid={testId}
    >
      <header className="mb-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          {roleBadge && (
            <span
              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
              data-testid={`${testId}-role`}
            >
              {roleBadge}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
      </header>

      {!loading && !hasActivity && (
        <p
          className="text-sm italic text-gray-500 dark:text-gray-400"
          data-testid={`${testId}-empty`}
        >
          {t('noActivity')}
        </p>
      )}

      {!loading && hasActivity && bucket && (
        <p className="text-sm" data-testid={`${testId}-totals`}>
          <span className="text-green-700 dark:text-green-400">
            {tTotals('in')} {formatAmount(bucket.inCents, currency, locale)}
          </span>{' '}
          ·{' '}
          <span className="text-red-700 dark:text-red-400">
            {tTotals('out')} {formatAmount(bucket.outCents, currency, locale)}
          </span>{' '}
          ·{' '}
          <span
            className={
              net >= 0
                ? 'font-medium text-gray-900 dark:text-gray-100'
                : 'font-medium text-red-700 dark:text-red-400'
            }
          >
            {tTotals('net')} {formatAmount(net, currency, locale)}
          </span>
        </p>
      )}

      <footer className="mt-3">
        <Link
          href={href}
          className="text-sm text-primary-600 hover:underline"
          data-testid={`${testId}-view`}
        >
          {t('view')} →
        </Link>
      </footer>
    </article>
  );
}
