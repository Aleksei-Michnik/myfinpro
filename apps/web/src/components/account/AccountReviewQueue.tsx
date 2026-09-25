'use client';

// Phase 20 · 20.5 — the pending-lines queue (UI spec §3–§4): filter tabs,
// bulk apply, an undo strip, roving-tabindex rows and the keyboard model
// (↑↓ move · Enter accept · M/C/T switch · I ignore · S skip · U undo · Esc).

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  StatementLineCard,
  accountScope,
  initialDecision,
  isDecisionReady,
  type LineDecision,
} from '@/components/account/StatementLineCard';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { RetryReturnDialog } from '@/components/ui/RetryReturnDialog';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { useAccounts, type AccountApiError } from '@/lib/account/account-context';
import { isReconciled } from '@/lib/account/formatters';
import type {
  AccountSummary,
  ListLinesParams,
  StatementLine,
  StatementLineDecision,
} from '@/lib/account/types';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';
import { arrowKeyDelta } from '@/lib/swipe';
import { formatAmount } from '@/lib/transaction/formatters';
import { useAsyncOperation } from '@/lib/ui';

export type ReviewFilter = 'all' | 'needsInput' | 'suggested' | 'decided';
export const REVIEW_FILTERS: ReviewFilter[] = ['all', 'needsInput', 'suggested', 'decided'];

const PAGE_SIZE = 25;
const CONFIRM_ABOVE = 20;

/** Query for a filter. `suggested` and `decided` narrow client-side (no single server value). */
export function paramsForFilter(filter: ReviewFilter, importId?: string): ListLinesParams {
  const base: ListLinesParams = { limit: PAGE_SIZE, importId };
  if (filter === 'decided') return base;
  if (filter === 'needsInput') return { ...base, status: 'PENDING', suggestion: 'needs_input' };
  return { ...base, status: 'PENDING' };
}

/** A proposal the matcher trusts: a match, a transfer, or a create with a category. */
export function isConfident(line: StatementLine): boolean {
  const s = line.suggestion;
  if (!s) return false;
  if (s.action === 'match') return !!s.transaction;
  if (s.action === 'transfer') return !!s.transferAccountId;
  if (s.action === 'create') return !!s.categoryId;
  return false;
}

export function visibleFor(filter: ReviewFilter, lines: StatementLine[]): StatementLine[] {
  if (filter === 'decided') return lines.filter((l) => l.status !== 'PENDING');
  if (filter === 'suggested') return lines.filter((l) => l.status === 'PENDING' && isConfident(l));
  return lines.filter((l) => l.status === 'PENDING');
}

export interface AccountReviewQueueProps {
  account: AccountSummary;
  /** Narrow to one import (`?import=`); the host renders the removable chip. */
  importId?: string;
  /** Called after any decision so the host refreshes the header counts. */
  onChanged(): void;
  onImportClick(): void;
  /** Focus returns here on Esc. */
  escapeTargetRef?: React.RefObject<HTMLElement | null>;
}

export function AccountReviewQueue({
  account,
  importId,
  onChanged,
  onImportClick,
  escapeTargetRef,
}: AccountReviewQueueProps) {
  const t = useTranslations('accounts.review');
  const tImport = useTranslations('accounts.import');
  const locale = useLocale();
  const { addToast } = useToast();
  const {
    fetchLines,
    matchLine,
    createFromLine,
    transferFromLine,
    ignoreLine,
    unlinkLine,
    applySuggestions,
  } = useAccounts();

  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, LineDecision>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [candidatesFor, setCandidatesFor] = useState<string | null>(null);
  const [lastDecided, setLastDecided] = useState<{ line: StatementLine; label: string } | null>(
    null,
  );
  const [confirmApply, setConfirmApply] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const fetchOp = useAsyncOperation<{ data: StatementLine[]; nextCursor: string | null }>({
    scope: 'container',
    id: 'account-lines-fetch',
  });
  const decideOp = useAsyncOperation<StatementLineDecision>({
    scope: 'control',
    id: 'statement-line-decide',
  });
  const undoOp = useAsyncOperation<StatementLineDecision>({
    scope: 'control',
    id: 'statement-line-undo',
  });
  const applyOp = useAsyncOperation<number>({
    scope: 'control',
    id: 'statement-apply-suggestions',
  });

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const load = useCallback(
    async (nextFilter: ReviewFilter, append: boolean) => {
      // An aborted run (a newer fetch, StrictMode's double effect, unmount) is not a failure.
      let aborted = false;
      const res = await fetchOp.run(async (signal) => {
        signal.addEventListener('abort', () => (aborted = true));
        const r = await fetchLines(
          account.id,
          {
            ...paramsForFilter(nextFilter, importId),
            cursor: append ? (cursor ?? undefined) : undefined,
          },
          signal,
        );
        return { data: r.data, nextCursor: r.nextCursor };
      });
      if (!res) {
        if (!append && !aborted) setShowErrorDialog(true);
        return;
      }
      setLines((prev) => (append ? [...prev, ...res.data] : res.data));
      setCursor(res.nextCursor);
      setLoadedOnce(true);
      setDecisions((prev) => {
        const next = append ? { ...prev } : {};
        for (const l of res.data) if (!next[l.id]) next[l.id] = initialDecision(l, account);
        return next;
      });
    },
    // fetchOp identity is stable; cursor is read at call time.
    [account, importId, cursor, fetchLines],
  );
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    void loadRef.current(filter, false);
    // Refetch when the filter, the import chip or the account changes.
  }, [filter, importId, account.id]);

  useRealtimeResync(() => void loadRef.current(filter, false));
  useRealtimeEvents({ type: 'transaction.deleted' }, () => void loadRef.current(filter, false));
  useRealtimeEvents({ type: 'transaction.updated' }, (e) => {
    setLines((prev) =>
      prev.map((l) =>
        l.transactionId === e.transaction.id ? { ...l, transaction: e.transaction } : l,
      ),
    );
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const visible = useMemo(() => visibleFor(filter, lines), [filter, lines]);
  const confidentCount = useMemo(
    () => lines.filter((l) => l.status === 'PENDING' && isConfident(l)).length,
    [lines],
  );
  const activeIndex = Math.max(
    0,
    visible.findIndex((l) => l.id === activeId),
  );
  const active = visible[activeIndex] ?? null;
  const loading = fetchOp.isLoading;
  const rowBusy = (id: string) => busyId === id && (decideOp.isLoading || undoOp.isLoading);

  useEffect(() => {
    if (!active && visible[0]) setActiveId(visible[0].id);
  }, [active, visible]);

  // ── Decisions ─────────────────────────────────────────────────────────────
  const replaceLocally = (next: StatementLine) =>
    setLines((prev) => prev.map((l) => (l.id === next.id ? next : l)));

  const moveTo = (index: number) => {
    const next = visible[Math.max(0, Math.min(index, visible.length - 1))];
    if (next) setActiveId(next.id);
  };

  const decide = async (line: StatementLine) => {
    const d = decisions[line.id];
    if (!d || !isDecisionReady(d)) return;
    setRowErrors((prev) => ({ ...prev, [line.id]: '' }));
    setBusyId(line.id);
    const res = await decideOp.run((signal) => {
      switch (d.kind) {
        case 'match':
          return matchLine(account.id, line.id, d.transactionId!, signal);
        case 'create':
          return createFromLine(
            account.id,
            line.id,
            { categoryIds: [d.categoryId!], attributions: [d.scope] },
            signal,
          );
        case 'transfer':
          return transferFromLine(account.id, line.id, d.transferAccountId!, signal);
        default:
          return ignoreLine(account.id, line.id, signal);
      }
    });
    setBusyId(null);
    if (!res) {
      const err = decideOp.error;
      setRowErrors((prev) => ({
        ...prev,
        [line.id]: err?.message ? `${t('actionFailed')} ${err.message}` : t('actionFailed'),
      }));
      return;
    }
    const label = t(
      `decided.${
        d.kind === 'match'
          ? 'matched'
          : d.kind === 'create'
            ? 'created'
            : d.kind === 'transfer'
              ? 'transferred'
              : 'ignored'
      }`,
    );
    const nextIndex = activeIndex;
    // The row stays in `lines`; the pending filters hide it, `decided` shows it.
    replaceLocally(res.line);
    setLastDecided({ line: res.line, label });
    addToast('success', `${line.description} — ${label}`);
    onChanged();
    // Cursor moves to what is now at the same position.
    setTimeout(() => moveTo(nextIndex), 0);
  };

  const ignore = async (line: StatementLine) => {
    setRowErrors((prev) => ({ ...prev, [line.id]: '' }));
    setBusyId(line.id);
    const res = await decideOp.run((signal) => ignoreLine(account.id, line.id, signal));
    setBusyId(null);
    if (!res) {
      setRowErrors((prev) => ({ ...prev, [line.id]: t('actionFailed') }));
      return;
    }
    const nextIndex = activeIndex;
    replaceLocally(res.line);
    setLastDecided({ line: res.line, label: t('decided.ignored') });
    addToast('success', `${line.description} — ${t('decided.ignored')}`);
    onChanged();
    setTimeout(() => moveTo(nextIndex), 0);
  };

  const undo = async (line: StatementLine) => {
    setBusyId(line.id);
    const res = await undoOp.run((signal) => unlinkLine(account.id, line.id, signal));
    setBusyId(null);
    if (!res) {
      addToast('error', t('actionFailed'));
      return;
    }
    replaceLocally(res.line);
    setDecisions((prev) => ({ ...prev, [line.id]: initialDecision(res.line, account) }));
    if (lastDecided?.line.id === line.id) setLastDecided(null);
    addToast('success', t('undone'));
    onChanged();
    setActiveId(line.id);
  };

  const applyAll = async () => {
    setConfirmApply(false);
    const total = await applyOp.run(async (signal) => {
      let matched = 0;
      let created = 0;
      let transferred = 0;
      let skipped = 0;
      for (;;) {
        const r = await applySuggestions(account.id, undefined, signal);
        matched += r.matched;
        created += r.created;
        transferred += r.transferred;
        skipped += r.skipped;
        if (r.remaining === 0 || r.matched + r.created + r.transferred === 0) break;
      }
      addToast('success', t('applied', { matched, created, transferred, skipped }));
      return matched + created + transferred;
    });
    if (total === undefined) {
      addToast('error', (applyOp.error as AccountApiError | null)?.message ?? t('actionFailed'));
      return;
    }
    onChanged();
    void loadRef.current(filter, false);
  };

  // ── Keyboard model ────────────────────────────────────────────────────────
  const focusIn = (id: string, selector: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-testid="line-row-${id}"] [data-testid="${selector}"]`,
    );
    (el?.querySelector('select, input') as HTMLElement | null)?.focus() ?? el?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (!active || candidatesFor) return;
    const target = e.target as HTMLElement;
    const inField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
    if (inField && e.key !== 'Escape' && e.key !== 'Enter') return;
    const d = decisions[active.id];
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveTo(activeIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(activeIndex - 1);
        break;
      case 'ArrowRight':
      case 'ArrowLeft': {
        e.preventDefault();
        moveTo(activeIndex + arrowKeyDelta(e.currentTarget, e.key));
        break;
      }
      case 'Enter':
        if (inField && target.tagName !== 'SELECT') return;
        e.preventDefault();
        if (active.status === 'PENDING') void decide(active);
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        if (active.suggestion?.candidates.length || active.suggestion?.transaction) {
          setDecisions((prev) => {
            const current = prev[active.id];
            return {
              ...prev,
              [active.id]: {
                kind: 'match',
                transactionId: current?.kind === 'match' ? current.transactionId : null,
              },
            };
          });
          setCandidatesFor(active.id);
        }
        break;
      case 'c':
      case 'C':
        e.preventDefault();
        setDecisions((prev) => ({
          ...prev,
          [active.id]:
            d?.kind === 'create'
              ? d
              : {
                  kind: 'create',
                  categoryId: active.suggestion?.categoryId ?? null,
                  scope: accountScope(account),
                },
        }));
        setTimeout(() => focusIn(active.id, `line-category-picker-${active.id}`), 0);
        break;
      case 't':
      case 'T':
        e.preventDefault();
        setDecisions((prev) => ({
          ...prev,
          [active.id]:
            d?.kind === 'transfer'
              ? d
              : {
                  kind: 'transfer',
                  transferAccountId: active.suggestion?.transferAccountId ?? null,
                },
        }));
        setTimeout(() => focusIn(active.id, `line-transfer-select-${active.id}`), 0);
        break;
      case 'i':
      case 'I':
        e.preventDefault();
        if (active.status === 'PENDING') void ignore(active);
        break;
      case 's':
      case 'S':
        e.preventDefault();
        moveTo(activeIndex + 1);
        break;
      case 'u':
      case 'U':
        e.preventDefault();
        if (lastDecided) void undo(lastDecided.line);
        break;
      case 'Escape':
        e.preventDefault();
        escapeTargetRef?.current?.focus();
        break;
      default:
        break;
    }
  };
  // Keep the active row focused and in view.
  useEffect(() => {
    if (!active) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-testid="line-row-${active.id}"]`);
    if (el && listRef.current?.contains(document.activeElement) && document.activeElement !== el) {
      // Only move focus when the user is already inside the queue.
      if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? ''))
        el.focus();
    }
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // ── Render ────────────────────────────────────────────────────────────────
  const gap = account.reconciliationGapCents;
  const emptyState = loadedOnce && visible.length === 0 && !loading;

  return (
    <div className="space-y-3" data-testid="account-review">
      <div className="z-10 space-y-2 bg-gray-50 py-2 lg:sticky lg:top-0 dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs
            items={REVIEW_FILTERS.map((f) => ({ key: f, label: t(`filters.${f}`) }))}
            current={filter}
            onChange={(k) => setFilter(k as ReviewFilter)}
            disabled={loading}
            ariaLabel={t('queueLabel')}
            data-testid="account-review-filter"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={confidentCount === 0 || applyOp.isLoading || loading}
            onClick={() =>
              confidentCount > CONFIRM_ABOVE ? setConfirmApply(true) : void applyAll()
            }
            data-testid="account-review-apply-all"
          >
            {t('applyAll', { count: confidentCount })}
          </Button>
        </div>
        {lastDecided && (
          <div
            className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
            data-testid="account-review-undo"
          >
            <span className="min-w-0 truncate">
              {t('undoBar', {
                description: lastDecided.line.description,
                decision: lastDecided.label,
              })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={undoOp.isLoading}
              onClick={() => void undo(lastDecided.line)}
              data-testid="account-review-undo-button"
            >
              {t('undo')}
            </Button>
          </div>
        )}
        <details className="text-xs text-gray-500 dark:text-gray-400">
          <summary className="cursor-pointer">{t('shortcuts')}</summary>
          <p className="mt-1">{t('shortcutList')}</p>
        </details>
      </div>

      <p role="status" aria-live="polite" className="sr-only" data-testid="account-review-status">
        {active
          ? `${t('position', { position: activeIndex + 1, count: visible.length })} · ${active.description}`
          : ''}
      </p>

      {!loadedOnce && loading ? (
        <ul
          role="status"
          aria-label={t('loading')}
          className="space-y-2"
          data-testid="account-review-loading"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="h-16 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
          ))}
        </ul>
      ) : emptyState ? (
        filter !== 'all' ? (
          <EmptyState title={t('emptyFilter')} data-testid="account-review-empty" />
        ) : lines.length === 0 &&
          account.pendingLinesCount === 0 &&
          !importId &&
          isReconciled(gap) ? (
          <EmptyState title={t('emptyReconciled')} data-testid="account-review-empty" />
        ) : typeof gap === 'number' && gap !== 0 ? (
          <EmptyState
            title={t('emptyGap', { amount: formatAmount(Math.abs(gap), account.currency, locale) })}
            action={
              <Button type="button" variant="primary" size="sm" onClick={onImportClick}>
                {tImport('title')}
              </Button>
            }
            data-testid="account-review-empty"
          />
        ) : (
          <EmptyState
            title={t('emptyNoImport')}
            action={
              <Button type="button" variant="primary" size="sm" onClick={onImportClick}>
                {tImport('title')}
              </Button>
            }
            data-testid="account-review-empty"
          />
        )
      ) : (
        <div className="relative">
          <ul
            ref={listRef}
            role="list"
            aria-label={t('queueLabel')}
            onKeyDown={onKeyDown}
            className="space-y-2"
            data-testid="account-review-list"
          >
            {visible.map((line) => (
              <StatementLineCard
                key={line.id}
                line={line}
                account={account}
                decision={decisions[line.id] ?? initialDecision(line, account)}
                onDecisionChange={(next) => setDecisions((prev) => ({ ...prev, [line.id]: next }))}
                active={line.id === active?.id}
                busy={rowBusy(line.id)}
                error={rowErrors[line.id] || null}
                onAccept={() => void decide(line)}
                onSkip={() => moveTo(visible.indexOf(line) + 1)}
                onIgnore={() => void ignore(line)}
                onUndo={line.status !== 'PENDING' ? () => void undo(line) : undefined}
                candidatesOpen={candidatesFor === line.id}
                onCandidatesOpenChange={(open) => setCandidatesFor(open ? line.id : null)}
                rowProps={{
                  tabIndex: line.id === active?.id ? 0 : -1,
                  'aria-current': line.id === active?.id ? 'true' : undefined,
                  onFocus: () => setActiveId(line.id),
                }}
              />
            ))}
          </ul>
          {cursor && (
            <div className="mt-3 flex justify-center">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={loading}
                onClick={() => void load(filter, true)}
                data-testid="account-review-load-more"
              >
                {t('loadMore')}
              </Button>
            </div>
          )}
          <LoadingOverlay active={loading && loadedOnce} />
        </div>
      )}

      {confirmApply && (
        <ConfirmDialog
          title={t('applyAllTitle')}
          message={t('applyAllConfirm', { count: confidentCount })}
          confirmLabel={t('confirm')}
          cancelLabel={t('cancel')}
          busy={applyOp.isLoading}
          onConfirm={() => void applyAll()}
          onClose={() => setConfirmApply(false)}
        />
      )}

      <RetryReturnDialog
        open={showErrorDialog}
        reason={fetchOp.error?.reason ?? 'unknown'}
        httpStatus={fetchOp.error?.httpStatus}
        onRetry={() => {
          setShowErrorDialog(false);
          void load(filter, false);
        }}
        onReturn={() => setShowErrorDialog(false)}
      />
    </div>
  );
}
