'use client';

// Phase 6 · Iteration 6.15 — top-level orchestrator for the aggregated
// dashboard. Composes <TotalsCard>, <ScopeEntryCards>, <RecentActivity>,
// <StarredPayments>, plus the always-visible <QuickAddPaymentButton>. Uses
// the `refreshKey` re-mount pattern to refresh every section when a new
// payment is created.
//
// Phase 6 · 6.18.1.4-hotfix (part 2) — single chokepoint realtime
// subscription. The four widgets above all derive from /payments data;
// rather than wire each to realtime individually, the dashboard listens
// for the relevant events at the top level and bumps `refreshKey` to
// re-mount every section. A short debounce (DEBOUNCE_MS) coalesces the
// burst of events that a single edit can produce (`payment.updated` +
// `payment_attribution.added` + `payment_attribution.removed`) into one
// refresh. Reconnect-after-gap also bumps `refreshKey` via
// `useRealtimeResync`.

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DeletionBanner } from '@/components/auth/DeletionBanner';
import { computeMonthRange } from '@/components/dashboard/date-range';
import { QuickAddPaymentButton } from '@/components/dashboard/QuickAddPaymentButton';
import { RecentActivity } from '@/components/dashboard/RecentActivity';
import { ScopeEntryCards } from '@/components/dashboard/ScopeEntryCards';
import { StarredPayments } from '@/components/dashboard/StarredPayments';
import { TotalsCard } from '@/components/dashboard/TotalsCard';
import { useAuth } from '@/lib/auth/auth-context';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';
import { useResetOnLocaleChange } from '@/lib/ui';

const DEBOUNCE_MS = 500;

export function DashboardClient() {
  const t = useTranslations('dashboard');
  const { user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  // Phase 6 · Iteration 6.16.5 — bump the refreshKey on locale switch to
  // re-mount each section. They will silently re-fetch in the new locale,
  // dropping any leftover error state from the previous render.
  useResetOnLocaleChange(() => {
    setRefreshKey((k) => k + 1);
  });

  // Debounced refresh: coalesce bursts of payment events (a single edit
  // typically emits update + attribution.added + attribution.removed) into
  // one re-mount per quiet period.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setRefreshKey((k) => k + 1);
    }, DEBOUNCE_MS);
  };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  useRealtimeEvents({ type: 'payment.created' }, scheduleRefresh);
  useRealtimeEvents({ type: 'payment.updated' }, scheduleRefresh);
  useRealtimeEvents({ type: 'payment.deleted' }, scheduleRefresh);
  useRealtimeEvents({ type: 'payment_attribution.removed' }, scheduleRefresh);
  useRealtimeEvents({ type: 'occurrence.created' }, scheduleRefresh);

  // Reconnect-after-gap: events published while the SSE channel was down
  // are lost. A refresh is the only way to make the widgets authoritative.
  useRealtimeResync(() => {
    setRefreshKey((k) => k + 1);
  });

  // Stable across the lifetime of the page; no need to recompute on each render.
  const range = useMemo(() => computeMonthRange(), []);

  return (
    <main className="container mx-auto space-y-6 px-4 py-6" data-testid="dashboard-main">
      {user?.scheduledDeletionAt && <DeletionBanner />}

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
        </div>
        <QuickAddPaymentButton onPaymentCreated={() => setRefreshKey((k) => k + 1)} />
      </header>

      <TotalsCard key={`totals-${refreshKey}`} fromIso={range.fromIso} toIso={range.toIso} />

      <ScopeEntryCards key={`scopes-${refreshKey}`} fromIso={range.fromIso} toIso={range.toIso} />

      <RecentActivity key={`recent-${refreshKey}`} />

      <StarredPayments key={`starred-${refreshKey}`} />
    </main>
  );
}
