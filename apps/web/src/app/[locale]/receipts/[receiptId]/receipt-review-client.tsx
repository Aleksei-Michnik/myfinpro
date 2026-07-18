'use client';

// Phase 7 · Iteration 7.8 — receipt review page: file preview beside an
// editable extracted header (merchant autocomplete against the global
// registry, date, currency, totals with a live mismatch warning) and one
// editable card per line item (8.24, `ReceiptItemCard`). Save = PATCH
// header + PUT items. Only REVIEW receipts are editable; other statuses
// render a read-only summary. Confirm (→ transaction) lands in 7.9.

import { CURRENCY_CODES } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ItemWalkthroughDialog } from '@/components/product/ItemWalkthroughDialog';
import { ProductQuickViewDialog } from '@/components/product/ProductQuickViewDialog';
import { ExtractionActivity } from '@/components/receipt/ExtractionActivity';
import { ReceiptConfirmDialog } from '@/components/receipt/ReceiptConfirmDialog';
import { ReceiptItemCard, type ItemRow } from '@/components/receipt/ReceiptItemCard';
import { ReceiptStatusPill } from '@/components/receipt/ReceiptStatusPill';
import { ReconcileReceiptDialog } from '@/components/receipt/ReconcileReceiptDialog';
import { Button } from '@/components/ui/Button';
import { DocumentViewer } from '@/components/ui/DocumentViewer';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { inputClass } from '@/components/ui/input-styles';
import { useToast } from '@/components/ui/Toast';
import { Link, useRouter } from '@/i18n/navigation';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { MerchantSuggestion, ReceiptItemInput, ReceiptSummary } from '@/lib/receipt/types';
import { useTransactions } from '@/lib/transaction/transaction-context';
import type { CategoryDto } from '@/lib/transaction/types';
import { useAsyncOperation } from '@/lib/ui';

/** "45.90" → 4590; empty → null; invalid → NaN sentinel via null+flag. */
function parseMoney(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

const centsToStr = (cents: number | null): string =>
  cents === null ? '' : (cents / 100).toFixed(2);

function receiptToItemRows(receipt: ReceiptSummary): ItemRow[] {
  return receipt.items.map((item) => ({
    rawName: item.rawName,
    quantityStr: String(item.quantity),
    unitPriceStr: centsToStr(item.unitPriceCents),
    discountStr: item.discountCents > 0 ? centsToStr(item.discountCents) : '',
    totalStr: centsToStr(item.totalCents),
    categoryId: item.categoryId,
  }));
}

export function ReceiptReviewClient({ receiptId }: { receiptId: string }) {
  const t = useTranslations('receipts.review');
  const tStatus = useTranslations('receipts.status');
  const tViewer = useTranslations('common.viewer');
  const { getReceipt, updateReceipt, replaceItems, searchMerchants, fetchFileBlob, retryReceipt } =
    useReceipts();
  const { listCategories } = useTransactions();
  const { addToast } = useToast();
  const router = useRouter();

  const [receipt, setReceipt] = useState<ReceiptSummary | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  // One object-URL per stored page (8.22), aligned with receipt.files.
  const [previewUrls, setPreviewUrls] = useState<(string | null)[]>([]);
  const [previewError, setPreviewError] = useState(false);

  // Header form state.
  const [merchantText, setMerchantText] = useState('');
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<MerchantSuggestion[]>([]);
  const [purchasedAt, setPurchasedAt] = useState('');
  const [currency, setCurrency] = useState('');
  const [totalStr, setTotalStr] = useState('');
  const [discountStr, setDiscountStr] = useState('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  // Row-click match editing (8.23) — open the walkthrough on that exact item.
  const [walkthroughItemId, setWalkthroughItemId] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  // Thumbnail-click product info (8.27) — ONE dialog serves the whole list.
  const [quickViewProductId, setQuickViewProductId] = useState<string | null>(null);
  // Attached receipts (Phase 8.15) finish via reconcile, not confirm. Auto-open
  // the reconcile dialog the first time such a receipt reaches REVIEW.
  const autoReconciledRef = useRef(false);

  const loadOp = useAsyncOperation<ReceiptSummary>({ scope: 'container' });
  const saveOp = useAsyncOperation<boolean>({ scope: 'control' });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hydrate = useCallback((fresh: ReceiptSummary) => {
    setReceipt(fresh);
    setMerchantText(fresh.merchantName ?? fresh.extractedMerchantName ?? '');
    setMerchantId(fresh.merchantId);
    setPurchasedAt(fresh.purchasedAt ? fresh.purchasedAt.slice(0, 16) : '');
    setCurrency(fresh.currency ?? '');
    setTotalStr(centsToStr(fresh.totalCents));
    setDiscountStr(fresh.discountCents ? centsToStr(fresh.discountCents) : '');
    setItems(receiptToItemRows(fresh));
    setDirty(false);
  }, []);

  const load = useCallback(() => {
    void loadOp
      .run((signal) => getReceipt(receiptId, signal))
      .then((fresh) => {
        if (fresh !== undefined) hydrate(fresh);
      });
    // loadOp identity is stable (useAsyncOperation contract).
  }, [getReceipt, receiptId, hydrate]);

  useEffect(() => {
    load();
  }, [load]);

  // Attached receipt reaches REVIEW → pop the reconciliation dialog once, so
  // the comparison surfaces the moment extraction lands (design §3).
  useEffect(() => {
    if (receipt?.transactionId && receipt.status === 'REVIEW' && !autoReconciledRef.current) {
      autoReconciledRef.current = true;
      setReconcileOpen(true);
    }
  }, [receipt?.transactionId, receipt?.status]);

  useRealtimeResync(() => {
    // Don't clobber in-progress edits on reconnect; refetch otherwise.
    if (!dirty) load();
  });

  useRealtimeEvents({ type: 'receipt.updated' }, (event) => {
    if (event.receipt.id !== receiptId) return;
    // Status transitions (e.g. EXTRACTING → REVIEW while the user watches)
    // rehydrate the form — unless the user is mid-edit.
    setReceipt((prev) => {
      if (!dirty || prev?.status !== event.receipt.status) hydrate(event.receipt);
      return event.receipt;
    });
  });

  // Authenticated per-page previews via blob object-URLs (8.22). A failure
  // surfaces as an inline error — a silent catch left the "loading"
  // placeholder forever. Pages are immutable after upload, so the id list
  // is a stable re-fetch key.
  const fileIdsKey = receipt?.files.map((f) => f.id).join(',') ?? '';
  useEffect(() => {
    if (!receipt || receipt.source !== 'upload' || receipt.files.length === 0) return;
    setPreviewError(false);
    const revoked: string[] = [];
    let cancelled = false;
    void Promise.all(receipt.files.map((file) => fetchFileBlob(receiptId, file.id)))
      .then((blobs) => {
        if (cancelled) return;
        const urls = blobs.map((blob) => URL.createObjectURL(blob));
        revoked.push(...urls);
        setPreviewUrls(urls);
      })
      .catch(() => {
        if (!cancelled) setPreviewError(true);
      });
    return () => {
      cancelled = true;
      for (const url of revoked) URL.revokeObjectURL(url);
      setPreviewUrls([]);
    };
    // Re-fetch only when the receipt identity/pages change, not on every patch.
  }, [receiptId, receipt?.source, fileIdsKey, fetchFileBlob]);

  useEffect(() => {
    void listCategories({ direction: 'OUT' })
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [listCategories]);

  // Merchant autocomplete (300ms debounce; picking pins the registry id).
  const onMerchantInput = (value: string) => {
    setMerchantText(value);
    setMerchantId(null);
    setDirty(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      void searchMerchants(value)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 300);
  };

  const pickMerchant = (m: MerchantSuggestion) => {
    setMerchantText(m.name);
    setMerchantId(m.id);
    setSuggestions([]);
    setDirty(true);
  };

  const setItem = (index: number, patch: Partial<ItemRow>) => {
    setItems((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setDirty(true);
  };
  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        rawName: '',
        quantityStr: '1',
        unitPriceStr: '',
        discountStr: '',
        totalStr: '',
        categoryId: null,
      },
    ]);
    setDirty(true);
  };
  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  // Live totals-mismatch (advisory, never blocks saving).
  const mismatchCents = useMemo(() => {
    const total = parseMoney(totalStr);
    if (total === null) return null;
    const itemsSum = items.reduce((sum, row) => sum + (parseMoney(row.totalStr) ?? 0), 0);
    const discount = parseMoney(discountStr) ?? 0;
    return total - (itemsSum - discount);
  }, [items, totalStr, discountStr]);

  // Walkthrough backlog — PENDING + SKIPPED are the resumable set (8.4).
  const unresolvedCount = useMemo(
    () =>
      receipt?.items.filter((i) => i.matchStatus === 'PENDING' || i.matchStatus === 'SKIPPED')
        .length ?? 0,
    [receipt],
  );

  // Pre-select the transaction's primary category from the most common line-item
  // category (confirm dialog default).
  const defaultCategoryId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of items) {
      if (row.categoryId) counts.set(row.categoryId, (counts.get(row.categoryId) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [id, count] of counts) {
      if (count > bestCount) {
        best = id;
        bestCount = count;
      }
    }
    return best;
  }, [items]);

  const save = () => {
    if (!receipt) return;
    // Validate item rows client-side (names + integer money).
    const parsedItems: ReceiptItemInput[] = [];
    for (const row of items) {
      const quantity = Number(row.quantityStr);
      const total = parseMoney(row.totalStr);
      if (!row.rawName.trim() || !Number.isFinite(quantity) || quantity <= 0 || total === null) {
        addToast('error', t('itemsInvalid'));
        return;
      }
      parsedItems.push({
        rawName: row.rawName.trim(),
        quantity,
        unitPriceCents: parseMoney(row.unitPriceStr),
        discountCents: parseMoney(row.discountStr) ?? 0,
        totalCents: total,
        categoryId: row.categoryId,
      });
    }

    void saveOp
      .run(async (signal) => {
        await updateReceipt(
          receipt.id,
          {
            extractedMerchantName: merchantText.trim() || null,
            merchantId,
            purchasedAt: purchasedAt ? new Date(purchasedAt).toISOString() : null,
            currency: currency || null,
            totalCents: parseMoney(totalStr),
            discountCents: parseMoney(discountStr),
          },
          signal,
        );
        const fresh = await replaceItems(receipt.id, parsedItems, signal);
        hydrate(fresh);
        return true;
      })
      .then((r) => {
        if (r !== undefined) addToast('success', t('savedToast'));
      });
  };

  useEffect(() => {
    if (saveOp.error && saveOp.error.reason !== 'aborted') {
      addToast('error', saveOp.error.message || t('saveFailed'));
    }
  }, [saveOp.error, addToast, t]);

  const handleRetry = () => {
    void saveOp
      .run(async (signal) => {
        const updated = await retryReceipt(receiptId, signal);
        hydrate(updated);
        return true;
      })
      .then((r) => {
        if (r !== undefined) addToast('success', t('retriedToast'));
      });
  };

  // ── Render branches ────────────────────────────────────────────────────

  if (loadOp.error && !receipt) {
    const notFound = loadOp.error.httpStatus === 404 || loadOp.error.httpStatus === 403;
    return (
      <main className="container mx-auto max-w-lg px-4 py-8">
        <div
          className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
          data-testid="receipt-review-error"
          role="alert"
        >
          <h1 className="mb-3 text-xl font-semibold text-gray-900 dark:text-gray-100">
            {notFound ? t('notFound') : t('loadFailed')}
          </h1>
          {!notFound && (
            <InlineErrorBanner
              reason={loadOp.error.reason}
              httpStatus={loadOp.error.httpStatus}
              onRetry={load}
            />
          )}
          <Link
            href="/receipts"
            className="mt-3 inline-block text-sm text-primary-700 hover:underline dark:text-primary-300"
            data-testid="receipt-review-back"
          >
            ← {t('back')}
          </Link>
        </div>
      </main>
    );
  }

  if (!receipt) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-8">
        <div
          className="flex items-center justify-center py-16"
          data-testid="receipt-review-loading"
          role="status"
        >
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
        </div>
      </main>
    );
  }

  const editable = receipt.status === 'REVIEW';

  return (
    <main className="container mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/receipts"
            className="text-sm text-primary-700 hover:underline dark:text-primary-300"
            data-testid="receipt-review-back"
          >
            ← {t('back')}
          </Link>
          {/* 8.19 — this receipt proves a transaction; link back to it. */}
          {receipt.transactionId && (
            <Link
              href={`/transactions/${receipt.transactionId}`}
              className="text-sm text-primary-700 hover:underline dark:text-primary-300"
              data-testid="receipt-review-transaction-link"
            >
              {t('viewTransaction')} →
            </Link>
          )}
        </div>
        <ReceiptStatusPill status={receipt.status} />
      </div>

      {receipt.status === 'FAILED' && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
          role="alert"
          data-testid="receipt-review-failed"
        >
          <span>{receipt.failureReason ?? tStatus('FAILED')}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleRetry}
            disabled={saveOp.isLoading}
            data-testid="receipt-review-retry"
          >
            {t('retry')}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── Preview ─────────────────────────────────────────────────── */}
        <section
          className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
          aria-label={t('previewTitle')}
          data-testid="receipt-preview"
        >
          {receipt.source === 'url' ? (
            <a
              href={receipt.sourceUrl ?? '#'}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all text-sm text-primary-700 hover:underline dark:text-primary-300"
              data-testid="receipt-preview-url"
            >
              {receipt.sourceUrl}
            </a>
          ) : previewUrls[0] ? (
            receipt.files[0]?.mimeType === 'application/pdf' ? (
              <div className="space-y-2">
                <object
                  data={previewUrls[0]}
                  type="application/pdf"
                  className="h-[60vh] w-full rounded"
                  aria-label={t('previewTitle')}
                  data-testid="receipt-preview-pdf"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setViewerOpen(true)}
                  data-testid="receipt-view-document"
                >
                  {t('viewDocument')}
                </Button>
              </div>
            ) : (
              // Blob object-URL — next/image can't consume it. The image is a
              // button: activating it opens the accessible zoom/pan viewer.
              <button
                type="button"
                onClick={() => setViewerOpen(true)}
                aria-label={t('viewDocument')}
                data-testid="receipt-view-document"
                className="block w-full cursor-zoom-in rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <img
                  src={previewUrls[0]}
                  alt={receipt.originalName ?? t('previewTitle')}
                  className="max-h-[70vh] w-full rounded object-contain"
                  data-testid="receipt-preview-image"
                />
                {receipt.files.length > 1 && (
                  <span
                    className="mt-1 block text-center text-xs text-gray-500 dark:text-gray-400"
                    data-testid="receipt-preview-pages"
                  >
                    {tViewer('pageOf', { current: 1, total: receipt.files.length })}
                  </span>
                )}
              </button>
            )
          ) : previewError ? (
            <div
              className="flex h-40 items-center justify-center text-sm text-red-600 dark:text-red-400"
              role="alert"
              data-testid="receipt-preview-error"
            >
              {tViewer('loadFailed')}
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-gray-400 dark:text-gray-500">
              {t('previewLoading')}
            </div>
          )}
        </section>

        {/* ── Extracted header ────────────────────────────────────────── */}
        <section
          className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
          aria-label={t('headerTitle')}
        >
          <div className="relative">
            <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
              <span>{t('merchantLabel')}</span>
              <input
                type="text"
                value={merchantText}
                onChange={(e) => onMerchantInput(e.target.value)}
                disabled={!editable}
                data-testid="review-merchant"
                className={inputClass}
                autoComplete="off"
              />
            </label>
            {suggestions.length > 0 && (
              <ul
                className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
                data-testid="merchant-suggestions"
                role="listbox"
              >
                {suggestions.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={merchantId === m.id}
                      onClick={() => pickMerchant(m)}
                      data-testid={`merchant-suggestion-${m.id}`}
                      className="w-full px-3 py-2 text-start text-sm text-gray-800 hover:bg-primary-50 dark:text-gray-100 dark:hover:bg-primary-900/30"
                    >
                      {m.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {merchantId && (
              <p
                className="mt-1 text-xs text-green-700 dark:text-green-400"
                data-testid="merchant-linked"
              >
                {t('merchantLinked')}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
              <span>{t('purchasedAtLabel')}</span>
              <input
                type="datetime-local"
                value={purchasedAt}
                onChange={(e) => {
                  setPurchasedAt(e.target.value);
                  setDirty(true);
                }}
                disabled={!editable}
                data-testid="review-purchased-at"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
              <span>{t('currencyLabel')}</span>
              <select
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  setDirty(true);
                }}
                disabled={!editable}
                data-testid="review-currency"
                className={inputClass}
              >
                <option value="">—</option>
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
              <span>{t('totalLabel')}</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={totalStr}
                onChange={(e) => {
                  setTotalStr(e.target.value);
                  setDirty(true);
                }}
                disabled={!editable}
                data-testid="review-total"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
              <span>{t('discountLabel')}</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={discountStr}
                onChange={(e) => {
                  setDiscountStr(e.target.value);
                  setDirty(true);
                }}
                disabled={!editable}
                data-testid="review-discount"
                className={inputClass}
              />
            </label>
          </div>

          {mismatchCents !== null && mismatchCents !== 0 && (
            <div
              className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
              role="status"
              data-testid="review-mismatch-warning"
            >
              {t('mismatchWarning', {
                delta: ((mismatchCents < 0 ? -mismatchCents : mismatchCents) / 100).toFixed(2),
              })}
            </div>
          )}

          {/* ── Items ───────────────────────────────────────────────── */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('itemsTitle')}
              </h2>
              {/* Walkthrough entry (Phase 8.4) — REVIEW and CONFIRMED; server
                  state is the source of truth, so unsaved edits gate it. */}
              {(receipt.status === 'REVIEW' || receipt.status === 'CONFIRMED') &&
                receipt.items.length > 0 && (
                  <div className="flex items-center gap-2">
                    {dirty && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {t('confirmSaveFirst')}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant={unresolvedCount > 0 ? 'primary' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setWalkthroughItemId(null);
                        setWalkthroughOpen(true);
                      }}
                      disabled={dirty}
                      data-testid="review-walkthrough"
                    >
                      {unresolvedCount > 0
                        ? t('matchProducts', { count: unresolvedCount })
                        : t('matchProductsDone')}
                    </Button>
                  </div>
                )}
            </div>
            {/* 8.26 — while extraction runs the (empty) items area becomes
                the live-progress panel; receipt.updated swaps it back. */}
            {receipt.status === 'UPLOADED' || receipt.status === 'EXTRACTING' ? (
              <ExtractionActivity receiptId={receiptId} variant="panel" />
            ) : (
              <div className="space-y-2" data-testid="review-items">
                {items.map((row, index) => (
                  <ReceiptItemCard
                    key={index}
                    index={index}
                    row={row}
                    // Server-truth match state — hidden while rows have unsaved
                    // edits (indices may no longer line up).
                    serverItem={!dirty ? receipt.items[index] : undefined}
                    editable={editable}
                    matchable={receipt.status === 'REVIEW' || receipt.status === 'CONFIRMED'}
                    categories={categories}
                    currency={currency || null}
                    onChange={(patch) => setItem(index, patch)}
                    onRemove={() => removeItem(index)}
                    onOpenMatch={(itemId) => {
                      setWalkthroughItemId(itemId);
                      setWalkthroughOpen(true);
                    }}
                    onOpenProduct={setQuickViewProductId}
                  />
                ))}
              </div>
            )}
            {editable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addItem}
                data-testid="review-add-item"
                className="mt-2"
              >
                {t('itemAdd')}
              </Button>
            )}
          </div>

          {editable && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
              {dirty && (
                <span
                  className="mr-auto text-xs text-gray-500 dark:text-gray-400"
                  data-testid="review-confirm-hint"
                >
                  {t('confirmSaveFirst')}
                </span>
              )}
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={save}
                disabled={saveOp.isLoading || !dirty}
                data-testid="review-save"
              >
                {t('save')}
              </Button>
              {receipt.transactionId ? (
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => setReconcileOpen(true)}
                  disabled={saveOp.isLoading || dirty}
                  data-testid="review-reconcile"
                >
                  {t('reconcile')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => setConfirmOpen(true)}
                  disabled={saveOp.isLoading || dirty}
                  data-testid="review-confirm"
                >
                  {t('confirm')}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>

      <ReceiptConfirmDialog
        open={confirmOpen}
        receiptId={receiptId}
        categories={categories}
        defaultCategoryId={defaultCategoryId}
        onCancel={() => setConfirmOpen(false)}
        onConfirmed={(transactionId) => {
          setConfirmOpen(false);
          router.push(`/transactions/${transactionId}`);
        }}
      />

      {/* Attached-receipt finish (Phase 8.15). Mounted only while open — its
          transaction fetch shouldn't run for plain confirm flows. */}
      {reconcileOpen && receipt.transactionId && (
        <ReconcileReceiptDialog
          open
          receipt={receipt}
          categories={categories}
          onCancel={() => setReconcileOpen(false)}
          onReconciled={(transactionId) => {
            setReconcileOpen(false);
            router.push(`/transactions/${transactionId}`);
          }}
        />
      )}

      {/* Mounted only while open — keeps the dialog (and its product-context
          dependency) entirely off the tree for plain review flows. */}
      {walkthroughOpen && (
        <ItemWalkthroughDialog
          open
          receipt={receipt}
          categories={categories}
          initialItemId={walkthroughItemId ?? undefined}
          onClose={() => {
            setWalkthroughOpen(false);
            setWalkthroughItemId(null);
          }}
          onReceiptUpdated={hydrate}
        />
      )}

      {/* Thumbnail-click product info (8.27) — mounted only while open, like
          the walkthrough. */}
      {quickViewProductId && (
        <ProductQuickViewDialog
          productId={quickViewProductId}
          onClose={() => setQuickViewProductId(null)}
        />
      )}

      {/* Popup document viewer (uploaded image/PDF) — zoom/pan for pictures,
          native PDF viewer for slips. URL receipts open externally instead. */}
      {receipt.source !== 'url' && (
        <DocumentViewer
          open={viewerOpen}
          pages={receipt.files.map((file, index) => ({
            kind: file.mimeType === 'application/pdf' ? ('pdf' as const) : ('image' as const),
            src: previewUrls[index] ?? null,
            downloadName: receipt.originalName ?? undefined,
          }))}
          loadError={previewError}
          title={
            // File name first — merchant names are receipt data in the
            // receipt's own language and read as a localisation bug.
            receipt.originalName ??
            receipt.merchantName ??
            receipt.extractedMerchantName ??
            t('previewTitle')
          }
          onClose={() => setViewerOpen(false)}
        />
      )}
    </main>
  );
}
