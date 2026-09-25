'use client';

// Phase 20 · 20.5 — one bank line in the review queue (UI spec §3 "Row
// anatomy"): head (date · description · amount), meta badges, the suggestion
// block rendered as the default action, and Accept / Skip / Ignore.

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { AccountSelect } from '@/components/account/AccountSelect';
import { LineCandidatesDialog } from '@/components/account/LineCandidatesDialog';
import { TransactionCategoryPicker } from '@/components/transaction/TransactionCategoryPicker';
import { TransactionScopeSelector } from '@/components/transaction/TransactionScopeSelector';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { Card } from '@/components/ui/Card';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import type { AccountSummary, StatementCandidate, StatementLine } from '@/lib/account/types';
import { formatAmount, formatOccurredDate, formatSignedAmount } from '@/lib/transaction/formatters';
import type { AttributionScope } from '@/lib/transaction/types';

/** What Accept will do for a line — seeded from the matcher's suggestion. */
export type LineDecision =
  | { kind: 'match'; transactionId: string | null }
  | { kind: 'create'; categoryId: string | null; scope: AttributionScope }
  | { kind: 'transfer'; transferAccountId: string | null }
  | { kind: 'ignore' };

export function accountScope(
  account: Pick<AccountSummary, 'scopeType' | 'groupId'>,
): AttributionScope {
  return account.scopeType === 'group' && account.groupId
    ? { scope: 'group', groupId: account.groupId }
    : { scope: 'personal' };
}

export function initialDecision(line: StatementLine, account: AccountSummary): LineDecision {
  const s = line.suggestion;
  if (s?.action === 'match' && s.transaction)
    return { kind: 'match', transactionId: s.transaction.id };
  if (s?.action === 'transfer')
    return { kind: 'transfer', transferAccountId: s.transferAccountId ?? null };
  return { kind: 'create', categoryId: s?.categoryId ?? null, scope: accountScope(account) };
}

/** A decision Accept can send right now. */
export function isDecisionReady(d: LineDecision): boolean {
  switch (d.kind) {
    case 'match':
      return d.transactionId !== null;
    case 'create':
      return d.categoryId !== null;
    case 'transfer':
      return d.transferAccountId !== null;
    default:
      return true;
  }
}

/** The suggested transaction first, then the ranked alternatives, no repeats. */
export function candidatesOf(line: StatementLine): StatementCandidate[] {
  const s = line.suggestion;
  if (!s) return [];
  const list = [...s.candidates];
  if (s.transaction && !list.some((c) => c.transaction.id === s.transaction!.id)) {
    list.unshift({ transaction: s.transaction, score: s.score });
  }
  return list;
}

export interface StatementLineCardProps {
  line: StatementLine;
  account: AccountSummary;
  decision: LineDecision;
  onDecisionChange(next: LineDecision): void;
  active: boolean;
  busy: boolean;
  error?: string | null;
  onAccept(): void;
  onSkip(): void;
  onIgnore(): void;
  /** Present on decided rows (the `decided` filter): reverses the decision. */
  onUndo?(): void;
  /** Roving tabindex + focus management live in the queue. */
  rowProps?: React.HTMLAttributes<HTMLLIElement>;
  /** The queue opens the candidate picker on `M`. */
  candidatesOpen: boolean;
  onCandidatesOpenChange(open: boolean): void;
}

export function StatementLineCard({
  line,
  account,
  decision,
  onDecisionChange,
  active,
  busy,
  error,
  onAccept,
  onSkip,
  onIgnore,
  onUndo,
  rowProps,
  candidatesOpen,
  onCandidatesOpenChange,
}: StatementLineCardProps) {
  const t = useTranslations('accounts.review');
  const locale = useLocale();
  const [scopeOpen, setScopeOpen] = useState(false);
  const candidates = candidatesOf(line);
  const decided = line.status !== 'PENDING';
  const needsCategory = decision.kind === 'create' && decision.categoryId === null;
  const pickedCandidate =
    decision.kind === 'match'
      ? candidates.find((c) => c.transaction.id === decision.transactionId)
      : undefined;

  const modeButton = (kind: LineDecision['kind'], label: string, shortcut: string) => (
    <button
      type="button"
      className={`rounded-full px-2 py-0.5 text-xs ${
        decision.kind === kind
          ? 'bg-primary-100 font-medium text-primary-800 dark:bg-primary-900/40 dark:text-primary-200'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
      }`}
      aria-pressed={decision.kind === kind}
      aria-keyshortcuts={shortcut}
      disabled={busy || decided}
      onClick={() => {
        if (kind === 'match') {
          onDecisionChange({ kind: 'match', transactionId: candidates[0]?.transaction.id ?? null });
          onCandidatesOpenChange(true);
        } else if (kind === 'create') {
          onDecisionChange({
            kind: 'create',
            categoryId: line.suggestion?.categoryId ?? null,
            scope: accountScope(account),
          });
        } else if (kind === 'transfer') {
          onDecisionChange({
            kind: 'transfer',
            transferAccountId: line.suggestion?.transferAccountId ?? null,
          });
        }
      }}
      data-testid={`line-mode-${kind}-${line.id}`}
    >
      {label}
    </button>
  );

  return (
    <Card
      as="li"
      padding="sm"
      muted={decided}
      className={active ? 'ring-2 ring-primary-500' : undefined}
      data-testid={`line-row-${line.id}`}
      data-status={line.status}
      {...rowProps}
    >
      {/* Head */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 md:flex-nowrap">
        <span
          dir="ltr"
          className="shrink-0 text-xs text-gray-500 dark:text-gray-400"
          data-testid={`line-date-${line.id}`}
        >
          {formatOccurredDate(line.postedAt, locale)}
          {line.valueAt && line.valueAt.slice(0, 10) !== line.postedAt.slice(0, 10) && (
            <span className="ms-1">
              · {t('valueAt', { date: formatOccurredDate(line.valueAt, locale) })}
            </span>
          )}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
          title={line.description}
          data-testid={`line-description-${line.id}`}
        >
          {line.description}
        </span>
        <span
          dir="ltr"
          className={`ms-auto shrink-0 font-mono text-sm ${
            line.direction === 'IN'
              ? 'text-green-700 dark:text-green-400'
              : 'text-gray-900 dark:text-gray-100'
          }`}
          data-testid={`line-amount-${line.id}`}
        >
          {formatSignedAmount(line, locale)}
        </span>
      </div>

      {/* Meta */}
      {(line.memo || line.installmentTotal || line.originalAmountCents || line.categoryHint) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          {line.memo && (
            <span className="truncate" title={line.memo}>
              {line.memo}
            </span>
          )}
          {line.installmentNumber && line.installmentTotal && (
            <Badge tone="neutral" size="sm" data-testid={`line-installment-${line.id}`}>
              {t('installment', { number: line.installmentNumber, total: line.installmentTotal })}
            </Badge>
          )}
          {typeof line.originalAmountCents === 'number' && line.originalCurrency && (
            <Badge tone="neutral" size="sm">
              <span dir="ltr">
                {t('original', {
                  amount: formatAmount(line.originalAmountCents, line.originalCurrency, locale),
                })}
              </span>
            </Badge>
          )}
          {line.categoryHint && (
            <Badge tone="neutral" size="sm">
              {line.categoryHint}
            </Badge>
          )}
        </div>
      )}

      {decided ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <Badge tone={line.status === 'IGNORED' ? 'neutral' : 'success'}>
            {t(
              `decided.${line.status === 'MATCHED' ? 'matched' : line.status === 'CREATED' ? 'created' : 'ignored'}`,
            )}
          </Badge>
          {onUndo && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onUndo}
              data-testid={`line-undo-${line.id}`}
            >
              {t('undo')}
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          {/* Suggestion block */}
          <div className="min-w-0 flex-1 space-y-2" data-testid={`line-suggestion-${line.id}`}>
            <div className="flex flex-wrap gap-1">
              {candidates.length > 0 && modeButton('match', t('matchTitle'), 'M')}
              {modeButton('create', t('createAs'), 'C')}
              {modeButton('transfer', t('transferTo'), 'T')}
            </div>

            {decision.kind === 'match' && (
              <Card padding="sm" muted data-testid={`line-candidate-${line.id}`}>
                {pickedCandidate ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span dir="ltr" className="text-xs text-gray-500 dark:text-gray-400">
                      {formatOccurredDate(pickedCandidate.transaction.occurredAt, locale)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {pickedCandidate.transaction.categories[0]?.name}
                      {pickedCandidate.transaction.note
                        ? ` · ${pickedCandidate.transaction.note}`
                        : ''}
                    </span>
                    <span dir="ltr" className="font-mono text-xs">
                      {formatSignedAmount(pickedCandidate.transaction, locale)}
                    </span>
                    <Badge tone={pickedCandidate.score >= 0.8 ? 'success' : 'neutral'} size="sm">
                      {t('candidateScore', { percent: Math.round(pickedCandidate.score * 100) })}
                    </Badge>
                  </div>
                ) : (
                  <span className="text-sm text-gray-500">{t('chooseAnother')}</span>
                )}
                {candidates.length > 1 && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-primary-700 underline dark:text-primary-300"
                    onClick={() => onCandidatesOpenChange(true)}
                    data-testid={`line-choose-another-${line.id}`}
                  >
                    {t('chooseAnother')}
                  </button>
                )}
              </Card>
            )}

            {decision.kind === 'create' && (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <TransactionCategoryPicker
                      direction={line.direction}
                      value={decision.categoryId}
                      onChange={(categoryId) =>
                        onDecisionChange({ ...decision, categoryId: categoryId || null })
                      }
                      disabled={busy}
                      testId={`line-category-picker-${line.id}`}
                    />
                  </div>
                  {needsCategory && (
                    <Badge tone="warning" size="sm" data-testid={`line-needs-category-${line.id}`}>
                      {t('needsCategory')}
                    </Badge>
                  )}
                </div>
                {scopeOpen ? (
                  <TransactionScopeSelector
                    value={[decision.scope]}
                    onChange={(next) => {
                      const last = next[next.length - 1];
                      if (last) onDecisionChange({ ...decision, scope: last });
                    }}
                    disabled={busy}
                  />
                ) : (
                  <button
                    type="button"
                    className="text-xs text-primary-700 underline dark:text-primary-300"
                    onClick={() => setScopeOpen(true)}
                  >
                    {t('changeScope')}
                  </button>
                )}
              </div>
            )}

            {decision.kind === 'transfer' && (
              <AccountSelect
                aria-label={t('transferTo')}
                value={decision.transferAccountId}
                onChange={(id) => onDecisionChange({ kind: 'transfer', transferAccountId: id })}
                currency={line.currency}
                excludeIds={[account.id]}
                disabled={busy}
                testId={`line-transfer-select-${line.id}`}
              />
            )}
          </div>

          {/* Actions */}
          <div className="flex shrink-0 flex-col-reverse gap-2 md:flex-row md:items-center">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={onSkip}
                aria-keyshortcuts="S"
                data-testid={`line-skip-${line.id}`}
              >
                {t('skip')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={onIgnore}
                aria-keyshortcuts="I"
                data-testid={`line-ignore-${line.id}`}
              >
                {t('ignore')}
              </Button>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="w-full md:w-auto"
              disabled={busy || !isDecisionReady(decision)}
              aria-busy={busy || undefined}
              aria-keyshortcuts="Enter"
              onClick={onAccept}
              data-testid={`line-accept-${line.id}`}
            >
              {busy && <ButtonSpinner />}
              {t('accept')}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2" role="alert">
          <InlineErrorBanner
            reason="unknown"
            message={error}
            data-testid={`line-error-${line.id}`}
          />
        </div>
      )}

      <LineCandidatesDialog
        open={candidatesOpen}
        candidates={candidates}
        value={decision.kind === 'match' ? decision.transactionId : null}
        onPick={(id) => {
          onDecisionChange({ kind: 'match', transactionId: id });
          onCandidatesOpenChange(false);
        }}
        onClose={() => onCandidatesOpenChange(false)}
      />
    </Card>
  );
}
