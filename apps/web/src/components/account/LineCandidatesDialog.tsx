'use client';

// Phase 20 · 20.5 — "Choose another": the matcher's ranked alternatives for a
// statement line (UI spec §3). ↑/↓ moves, 1–9 jumps, Enter picks, Esc closes.

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Dialog } from '@/components/ui/Dialog';
import type { StatementCandidate } from '@/lib/account/types';
import { formatOccurredDate, formatSignedAmount } from '@/lib/transaction/formatters';

export interface LineCandidatesDialogProps {
  open: boolean;
  candidates: StatementCandidate[];
  value: string | null;
  onPick(transactionId: string): void;
  onClose(): void;
}

export function LineCandidatesDialog({
  open,
  candidates,
  value,
  onPick,
  onClose,
}: LineCandidatesDialogProps) {
  const t = useTranslations('accounts.review');
  const locale = useLocale();
  const listRef = useRef<HTMLUListElement>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!open) return;
    const idx = candidates.findIndex((c) => c.transaction.id === value);
    setSelected(idx === -1 ? 0 : idx);
    listRef.current?.focus();
  }, [open, candidates, value]);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, candidates.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (candidates[selected]) onPick(candidates[selected].transaction.id);
        break;
      default: {
        const digit = Number(e.key);
        if (digit >= 1 && digit <= Math.min(9, candidates.length)) {
          e.preventDefault();
          onPick(candidates[digit - 1].transaction.id);
        }
      }
    }
  };

  if (!open) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('candidates')}
      size="sm"
      stacked
      testId="line-candidates-dialog"
    >
      <ul
        ref={listRef}
        tabIndex={0}
        role="listbox"
        aria-label={t('candidates')}
        aria-activedescendant={candidates[selected] ? `line-candidate-${selected}` : undefined}
        onKeyDown={onKeyDown}
        className="max-h-80 space-y-1 overflow-y-auto focus:outline-none"
      >
        {candidates.map((c, i) => {
          const primary = c.transaction.categories[0]?.name;
          return (
            <li
              key={c.transaction.id}
              id={`line-candidate-${i}`}
              role="option"
              aria-selected={i === selected}
              onClick={() => onPick(c.transaction.id)}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                i === selected
                  ? 'bg-primary-50 ring-1 ring-primary-500 dark:bg-primary-900/30'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
              }`}
              data-testid={`line-candidate-option-${i + 1}`}
            >
              <span className="w-4 text-xs text-gray-400">{i + 1}</span>
              <span dir="ltr" className="w-24 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                {formatOccurredDate(c.transaction.occurredAt, locale)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {primary ? `${primary} · ` : ''}
                {c.transaction.note ?? ''}
              </span>
              <span dir="ltr" className="font-mono text-xs">
                {formatSignedAmount(c.transaction, locale)}
              </span>
              <Badge tone={c.score >= 0.8 ? 'success' : 'neutral'} size="sm">
                {t('candidateScore', { percent: Math.round(c.score * 100) })}
              </Badge>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
