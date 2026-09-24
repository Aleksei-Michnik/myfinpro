'use client';

// Phase 8.28 — the shared modal shell behind both link directions: pick an
// existing transaction for a receipt, or an existing receipt for a transaction.
// Generic over the candidate type; the concrete dialogs supply the fetcher, the
// row renderer, and already-translated chrome strings. Modal semantics mirror
// AttachReceiptDialog (portal, focus-on-open, Esc/backdrop close, dark-mode
// variants). The parent owns the actual link call + routing; this component only
// surfaces candidates and reports the selection.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { inputClass } from '@/components/ui/input-styles';
import { useAsyncOperation } from '@/lib/ui';

export interface LinkPickerDialogProps<T> {
  open: boolean;
  title: string;
  hint: string;
  searchPlaceholder: string;
  searchLabel: string;
  emptyLabel: string;
  loadingLabel: string;
  /** Fetch candidates for the (possibly empty) search term. */
  fetchCandidates(search: string, signal: AbortSignal): Promise<T[]>;
  getKey(item: T): string;
  renderRow(item: T): ReactNode;
  onSelect(item: T): void;
  /** A link call is in flight — freeze the rows. */
  busy: boolean;
  /** Show the search box (default true). The receipt list has no text search. */
  searchable?: boolean;
  onClose(): void;
  testIdPrefix: string;
}

export function LinkPickerDialog<T>({
  open,
  title,
  hint,
  searchPlaceholder,
  searchLabel,
  emptyLabel,
  loadingLabel,
  fetchCandidates,
  getKey,
  renderRow,
  onSelect,
  busy,
  searchable = true,
  onClose,
  testIdPrefix,
}: LinkPickerDialogProps<T>) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const listOp = useAsyncOperation<T[]>({ scope: 'container' });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced fetch keyed on the search term; runs once immediately on open.
  useEffect(() => {
    if (!open) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(
      () => {
        void listOp
          .run((signal) => fetchCandidates(search.trim(), signal))
          .then((data) => {
            if (data !== undefined) setItems(data);
          });
      },
      search ? 300 : 0,
    );
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
    // listOp identity is stable (useAsyncOperation contract); fetchCandidates is
    // memoised by the caller.
  }, [open, search, fetchCandidates]);

  if (!open || typeof document === 'undefined') return null;

  return (
    <Dialog
      open
      onClose={onClose}
      variant="sheet"
      title={title}
      titleId={`${testIdPrefix}-title`}
      testId={`${testIdPrefix}-dialog`}
      backdropTestId={`${testIdPrefix}-backdrop`}
      closeTestId={`${testIdPrefix}-close`}
      className="max-h-[85vh]"
    >
      <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>

      {searchable && (
        <>
          <label htmlFor={`${testIdPrefix}-search`} className="sr-only">
            {searchLabel}
          </label>
          <input
            id={`${testIdPrefix}-search`}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            data-testid={`${testIdPrefix}-search`}
            className={inputClass}
            autoComplete="off"
          />
        </>
      )}

      <div className="min-h-[6rem] flex-1 overflow-y-auto" aria-busy={busy || undefined}>
        {listOp.isLoading && items.length === 0 ? (
          <div
            className="flex justify-center py-8"
            role="status"
            aria-label={loadingLabel}
            data-testid={`${testIdPrefix}-loading`}
          >
            <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-primary-600" />
          </div>
        ) : listOp.error ? (
          <InlineErrorBanner
            reason={listOp.error.reason}
            httpStatus={listOp.error.httpStatus}
            onRetry={() =>
              void listOp
                .run((signal) => fetchCandidates(search.trim(), signal))
                .then((data) => {
                  if (data !== undefined) setItems(data);
                })
            }
          />
        ) : items.length === 0 ? (
          <p
            className="py-8 text-center text-sm text-gray-500 dark:text-gray-400"
            data-testid={`${testIdPrefix}-empty`}
          >
            {emptyLabel}
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid={`${testIdPrefix}-list`}>
            {items.map((item) => (
              <li key={getKey(item)}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSelect(item)}
                  data-testid={`${testIdPrefix}-option-${getKey(item)}`}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-start hover:border-primary-400 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50 dark:border-gray-700 dark:hover:border-primary-500 dark:hover:bg-primary-900/20"
                >
                  {renderRow(item)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
