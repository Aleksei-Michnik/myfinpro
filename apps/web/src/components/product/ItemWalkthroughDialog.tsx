'use client';

// Phase 8 · Iteration 8.4 — the item walkthrough (design §1.3).
//
// Steps through the receipt's line items. Per item: the staged matcher's
// ranked proposals (confidence meter + stage), a registry search, barcode
// scan-to-find, create-new, and skip. Every action persists server-side
// (per-item POST — no full-receipt churn), so closing mid-way is always
// safe and SKIPPED items stay resumable.
//
// Keyboard-first (the 8.4 acceptance): ↑/↓ or 1–9 choose a candidate,
// Enter confirms, S skips, N creates, ←/→ navigate, Esc closes. Focus is
// trapped in the dialog; step changes are announced via aria-live;
// transitions are instant (reduced-motion safe by construction).

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarcodeScannerDialog } from './BarcodeScannerDialog';
import { ProductFormDialog } from './ProductFormDialog';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import type { CategoryDto } from '@/lib/payment/types';
import { useProducts } from '@/lib/product/product-context';
import type { ProductMatchCandidate, ProductSummary } from '@/lib/product/types';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { ReceiptItem, ReceiptSummary } from '@/lib/receipt/types';
import { useAsyncOperation } from '@/lib/ui';

const SEARCH_DEBOUNCE_MS = 300;

export interface ItemWalkthroughDialogProps {
  open: boolean;
  receipt: ReceiptSummary;
  categories: CategoryDto[];
  onClose(): void;
  /** Every per-item mutation returns the fresh receipt — parent stays in sync. */
  onReceiptUpdated(fresh: ReceiptSummary): void;
}

function formatMoney(cents: number | null, currency: string | null, locale: string): string {
  if (cents === null) return '—';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency ?? 'USD' }).format(
      cents / 100,
    );
  } catch {
    return (cents / 100).toFixed(2);
  }
}

/** Candidate row option — either a matcher proposal or a search result. */
interface Option {
  productId: string;
  name: string;
  brand: string | null;
  /** Present for matcher proposals; absent for live search results. */
  stage?: ProductMatchCandidate['stage'];
  confidence?: number;
}

export function ItemWalkthroughDialog({
  open,
  receipt,
  categories,
  onClose,
  onReceiptUpdated,
}: ItemWalkthroughDialogProps) {
  const t = useTranslations('products.walkthrough');
  const locale = useLocale();
  const { matchItem, skipItemMatch } = useReceipts();
  const { fetchProducts, lookupBarcode } = useProducts();
  const { addToast } = useToast();

  const items = receipt.items;
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<Option[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBarcode, setCreateBarcode] = useState<string | undefined>(undefined);

  const actOp = useAsyncOperation<ReceiptSummary>({ scope: 'control' });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbort = useRef<AbortController | null>(null);

  const item: ReceiptItem | undefined = items[index];
  const unresolved = useMemo(
    () => items.filter((i) => i.matchStatus === 'PENDING' || i.matchStatus === 'SKIPPED').length,
    [items],
  );

  // Start at the first unresolved item each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const first = items.findIndex((i) => i.matchStatus === 'PENDING');
    setIndex(first === -1 ? 0 : first);
    setSelected(0);
    setSearchText('');
    setSearchResults([]);
    setTimeout(() => dialogRef.current?.focus(), 0);
    // Deliberately keyed on `open` alone — item edits while the dialog is
    // up must not yank the user's position.
  }, [open]);

  // Reset the per-item transient state when stepping.
  useEffect(() => {
    setSelected(0);
    setSearchText('');
    setSearchResults([]);
  }, [index]);

  useEffect(() => {
    if (actOp.error && actOp.error.reason !== 'aborted') {
      addToast('error', actOp.error.message || t('actionFailed'));
    }
  }, [actOp.error, addToast, t]);

  const options: Option[] = useMemo(() => {
    if (!item) return [];
    const proposals: Option[] = item.matchCandidates.map((c) => ({
      productId: c.productId,
      name: c.name,
      brand: c.brand,
      stage: c.stage,
      confidence: c.confidence,
    }));
    // A confirmed/auto link not present in the proposals leads the list.
    if (item.productId && !proposals.some((p) => p.productId === item.productId)) {
      proposals.unshift({
        productId: item.productId,
        name: item.productName ?? '',
        brand: item.productBrand,
      });
    }
    const seen = new Set(proposals.map((p) => p.productId));
    return [...proposals, ...searchResults.filter((r) => !seen.has(r.productId))];
  }, [item, searchResults]);

  const goto = useCallback(
    (nextIndex: number) => {
      if (nextIndex >= 0 && nextIndex < items.length) setIndex(nextIndex);
    },
    [items.length],
  );

  /** After a mutation: jump to the next PENDING item, or stay on the last. */
  const advance = useCallback(
    (fresh: ReceiptSummary) => {
      onReceiptUpdated(fresh);
      const next = fresh.items.findIndex(
        (i, position) => position > index && i.matchStatus === 'PENDING',
      );
      if (next !== -1) {
        setIndex(next);
        return;
      }
      const anyPending = fresh.items.findIndex((i) => i.matchStatus === 'PENDING');
      if (anyPending !== -1) setIndex(anyPending);
    },
    [index, onReceiptUpdated],
  );

  const confirmProduct = useCallback(
    (productId: string) => {
      if (!item || actOp.isLoading) return;
      void actOp
        .run((signal) => matchItem(receipt.id, item.id, { productId }, signal))
        .then((fresh) => {
          if (fresh !== undefined) advance(fresh);
        });
    },
    [item, actOp, matchItem, receipt.id, advance],
  );

  const skip = useCallback(() => {
    if (!item || actOp.isLoading) return;
    void actOp
      .run((signal) => skipItemMatch(receipt.id, item.id, signal))
      .then((fresh) => {
        if (fresh !== undefined) advance(fresh);
      });
  }, [item, actOp, skipItemMatch, receipt.id, advance]);

  // Debounced registry search with AbortSignal reuse (design §6).
  const onSearch = (value: string) => {
    setSearchText(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchAbort.current?.abort();
    if (value.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      const controller = new AbortController();
      searchAbort.current = controller;
      void fetchProducts({ search: value.trim() }, controller.signal)
        .then((page) =>
          setSearchResults(
            page.data.map((p) => ({ productId: p.id, name: p.name, brand: p.brand })),
          ),
        )
        .catch(() => undefined);
    }, SEARCH_DEBOUNCE_MS);
  };

  const onScanDetected = (code: string) => {
    void lookupBarcode(code)
      .then((res) => {
        if (res.found && res.product) {
          confirmProduct(res.product.id);
          return;
        }
        // Unknown barcode → straight into create, code attached, OFF prefill
        // (or manual entry) handled inside the form.
        setCreateBarcode(code);
        setCreateOpen(true);
      })
      .catch(() => addToast('error', t('actionFailed')));
  };

  // Keyboard-fast flow (8.4 acceptance).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (createOpen || scannerOpen) return;
    const inSearch = document.activeElement === searchRef.current;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (inSearch && e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelected((prev) => Math.min(prev + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelected((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (options[selected]) confirmProduct(options[selected].productId);
        break;
      case 'ArrowRight':
        e.preventDefault();
        goto(index + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        goto(index - 1);
        break;
      case 's':
      case 'S':
        e.preventDefault();
        skip();
        break;
      case 'n':
      case 'N':
        e.preventDefault();
        setCreateBarcode(undefined);
        setCreateOpen(true);
        break;
      default: {
        const digit = Number(e.key);
        if (digit >= 1 && digit <= Math.min(9, options.length)) {
          e.preventDefault();
          setSelected(digit - 1);
        }
      }
    }
  };

  if (!open || typeof document === 'undefined' || !item) return null;

  const done = items.length - unresolved;
  const statusKey = item.matchStatus.toLowerCase() as 'pending' | 'auto' | 'confirmed' | 'skipped';

  const node = (
    <div
      data-testid="walkthrough-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-gray-900/60 sm:items-center sm:p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="walkthrough-dialog"
        className="flex max-h-[92vh] w-full max-w-lg flex-col gap-3 rounded-t-2xl border border-gray-200 bg-white p-5 shadow-xl outline-none sm:rounded-2xl dark:border-gray-700 dark:bg-gray-800"
      >
        {/* Header + progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2
              id="walkthrough-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              {t('title')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('close')}
              data-testid="walkthrough-close"
              className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-valuenow={done}
            aria-label={t('progressLabel')}
            className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
          >
            <div
              className="h-full rounded-full bg-primary-600 transition-[width] motion-reduce:transition-none"
              style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
            />
          </div>
          <p aria-live="polite" className="text-xs text-gray-500 dark:text-gray-400">
            {t('progress', { current: index + 1, total: items.length, resolved: done })}
          </p>
        </div>

        {/* Current item */}
        <div
          className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
          data-testid="walkthrough-item"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-gray-900 dark:text-gray-100">{item.rawName}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                item.matchStatus === 'CONFIRMED'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                  : item.matchStatus === 'AUTO'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                    : item.matchStatus === 'SKIPPED'
                      ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
              }`}
              data-testid="walkthrough-item-status"
            >
              {t(`status.${statusKey}`)}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {item.quantity} × {formatMoney(item.unitPriceCents, receipt.currency, locale)} ={' '}
            {formatMoney(item.totalCents, receipt.currency, locale)}
          </p>
          {item.productName && (
            <p
              className="mt-1 text-sm text-green-700 dark:text-green-400"
              data-testid="walkthrough-linked"
            >
              {t('linkedTo', { name: item.productName })}
            </p>
          )}
        </div>

        {/* Candidates + search */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          <label htmlFor="walkthrough-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <input
            id="walkthrough-search"
            ref={searchRef}
            type="search"
            value={searchText}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
            data-testid="walkthrough-search"
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />

          {options.length === 0 ? (
            <p
              className="py-3 text-center text-sm text-gray-500 dark:text-gray-400"
              data-testid="walkthrough-no-candidates"
            >
              {t('noCandidates')}
            </p>
          ) : (
            <ul
              role="listbox"
              aria-label={t('candidatesLabel')}
              className="space-y-1"
              data-testid="walkthrough-candidates"
            >
              {options.map((option, i) => {
                const isSelected = i === selected;
                return (
                  <li key={option.productId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setSelected(i);
                        confirmProduct(option.productId);
                      }}
                      disabled={actOp.isLoading}
                      data-testid={`walkthrough-candidate-${i}`}
                      className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-start text-sm transition-colors motion-reduce:transition-none ${
                        isSelected
                          ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/30'
                          : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-gray-900 dark:text-gray-100">
                          {i < 9 && (
                            <span className="text-gray-400 dark:text-gray-500">{i + 1}. </span>
                          )}
                          {option.name}
                        </span>
                        {option.brand && (
                          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                            {option.brand}
                          </span>
                        )}
                      </span>
                      {option.confidence !== undefined && (
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className="h-1.5 w-12 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600"
                          >
                            <span
                              className={`block h-full rounded-full ${
                                option.confidence >= 0.9
                                  ? 'bg-green-500'
                                  : option.confidence >= 0.6
                                    ? 'bg-amber-500'
                                    : 'bg-gray-400'
                              }`}
                              style={{ width: `${Math.round(option.confidence * 100)}%` }}
                            />
                          </span>
                          <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
                            {Math.round(option.confidence * 100)}%
                          </span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goto(index - 1)}
            disabled={index === 0}
            aria-label={t('prev')}
            data-testid="walkthrough-prev"
          >
            ←
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goto(index + 1)}
            disabled={index >= items.length - 1}
            aria-label={t('next')}
            data-testid="walkthrough-next"
          >
            →
          </Button>
          <span className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setScannerOpen(true)}
            disabled={actOp.isLoading}
            data-testid="walkthrough-scan"
          >
            {t('scan')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setCreateBarcode(undefined);
              setCreateOpen(true);
            }}
            disabled={actOp.isLoading}
            data-testid="walkthrough-create"
          >
            {t('createNew')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={skip}
            disabled={actOp.isLoading}
            data-testid="walkthrough-skip"
          >
            {t('skip')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => options[selected] && confirmProduct(options[selected].productId)}
            disabled={actOp.isLoading || !options[selected]}
            data-testid="walkthrough-confirm"
          >
            {t('confirm')}
          </Button>
        </div>
        <p className="text-center text-xs text-gray-400 dark:text-gray-500">{t('keyboardHint')}</p>
      </div>

      <BarcodeScannerDialog
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={onScanDetected}
      />
      <ProductFormDialog
        open={createOpen}
        initialName={item.rawName}
        initialBarcode={createBarcode}
        categories={categories}
        onCancel={() => setCreateOpen(false)}
        onSaved={(product: ProductSummary) => {
          setCreateOpen(false);
          confirmProduct(product.id);
        }}
      />
    </div>
  );

  return createPortal(node, document.body);
}
