'use client';

// Phase 7 · Iteration 7.8 — receipt review page: file preview beside an
// editable extracted header (merchant autocomplete against the global
// registry, date, currency, totals with a live mismatch warning) and an
// editable line-items table with per-item category selects. Save = PATCH
// header + PUT items. Only REVIEW receipts are editable; other statuses
// render a read-only summary. Confirm (→ payment) lands in 7.9.

import { CURRENCY_CODES } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ItemWalkthroughDialog } from '@/components/product/ItemWalkthroughDialog';
import { ReceiptConfirmDialog } from '@/components/receipt/ReceiptConfirmDialog';
import { ReceiptStatusPill } from '@/components/receipt/ReceiptStatusPill';
import { ReconcileReceiptDialog } from '@/components/receipt/ReconcileReceiptDialog';
import { Button } from '@/components/ui/Button';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useToast } from '@/components/ui/Toast';
import { Link, useRouter } from '@/i18n/navigation';
import { usePayments } from '@/lib/payment/payment-context';
import type { CategoryDto } from '@/lib/payment/types';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { MerchantSuggestion, ReceiptItemInput, ReceiptSummary } from '@/lib/receipt/types';
import { useAsyncOperation } from '@/lib/ui';

interface ItemRow {
  rawName: string;
  quantityStr: string;
  unitPriceStr: string;
  discountStr: string;
  totalStr: string;
  categoryId: string | null;
}

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

const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 ' +
  'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 ' +
  'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

export function ReceiptReviewClient({ receiptId }: { receiptId: string }) {
  const t = useTranslations('receipts.review');
  const tStatus = useTranslations('receipts.status');
  const { getReceipt, updateReceipt, replaceItems, searchMerchants, fetchFileBlob, retryReceipt } =
    useReceipts();
  const { listCategories } = usePayments();
  const { addToast } = useToast();
  const router = useRouter();

  const [receipt, setReceipt] = useState<ReceiptSummary | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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
    if (receipt?.paymentId && receipt.status === 'REVIEW' && !autoReconciledRef.current) {
      autoReconciledRef.current = true;
      setReconcileOpen(true);
    }
  }, [receipt?.paymentId, receipt?.status]);

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

  // Authenticated file preview via a blob object-URL.
  useEffect(() => {
    if (!receipt || receipt.source !== 'upload') return;
    let revoked: string | null = null;
    let cancelled = false;
    void fetchFileBlob(receiptId)
      .then((blob) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setPreviewUrl(revoked);
      })
      .catch(() => {
        /* preview is best-effort */
      });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
    // Re-fetch only when the receipt identity changes, not on every patch.
  }, [receiptId, receipt?.source, fetchFileBlob]);

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

  // Pre-select the payment's primary category from the most common line-item
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
        <Link
          href="/receipts"
          className="text-sm text-primary-700 hover:underline dark:text-primary-300"
          data-testid="receipt-review-back"
        >
          ← {t('back')}
        </Link>
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
          ) : previewUrl ? (
            receipt.mimeType === 'application/pdf' ? (
              <object
                data={previewUrl}
                type="application/pdf"
                className="h-[70vh] w-full rounded"
                aria-label={t('previewTitle')}
                data-testid="receipt-preview-pdf"
              />
            ) : (
              // Blob object-URL — next/image can't consume it.
              <img
                src={previewUrl}
                alt={receipt.originalName ?? t('previewTitle')}
                className="max-h-[70vh] w-full rounded object-contain"
                data-testid="receipt-preview-image"
              />
            )
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
                      onClick={() => setWalkthroughOpen(true)}
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
            <div className="space-y-2" data-testid="review-items">
              {items.map((row, index) => (
                <div
                  key={index}
                  className="grid grid-cols-12 items-center gap-1.5"
                  data-testid={`review-item-${index}`}
                >
                  <div className="col-span-4 flex items-center gap-1.5">
                    {/* Product-match state dot (Phase 8) — server truth, so
                        it hides while there are unsaved row edits. */}
                    {!dirty && receipt.items[index] && (
                      <span
                        aria-label={t(
                          `matchState.${receipt.items[index].matchStatus.toLowerCase()}`,
                        )}
                        title={
                          receipt.items[index].productName ??
                          t(`matchState.${receipt.items[index].matchStatus.toLowerCase()}`)
                        }
                        data-testid={`item-match-${index}`}
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          receipt.items[index].matchStatus === 'CONFIRMED'
                            ? 'bg-green-500'
                            : receipt.items[index].matchStatus === 'AUTO'
                              ? 'bg-blue-500'
                              : receipt.items[index].matchStatus === 'SKIPPED'
                                ? 'bg-gray-300 dark:bg-gray-600'
                                : 'bg-amber-400'
                        }`}
                      />
                    )}
                    <input
                      type="text"
                      value={row.rawName}
                      onChange={(e) => setItem(index, { rawName: e.target.value })}
                      placeholder={t('itemName')}
                      disabled={!editable}
                      data-testid={`item-name-${index}`}
                      className={inputClass}
                    />
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.001"
                    value={row.quantityStr}
                    onChange={(e) => setItem(index, { quantityStr: e.target.value })}
                    placeholder={t('itemQty')}
                    title={t('itemQty')}
                    disabled={!editable}
                    data-testid={`item-qty-${index}`}
                    className={`${inputClass} col-span-1`}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={row.totalStr}
                    onChange={(e) => setItem(index, { totalStr: e.target.value })}
                    placeholder={t('itemTotal')}
                    title={t('itemTotal')}
                    disabled={!editable}
                    data-testid={`item-total-${index}`}
                    className={`${inputClass} col-span-2`}
                  />
                  <select
                    value={row.categoryId ?? ''}
                    onChange={(e) => setItem(index, { categoryId: e.target.value || null })}
                    disabled={!editable}
                    data-testid={`item-category-${index}`}
                    className={`${inputClass} col-span-4`}
                  >
                    <option value="">{t('itemNoCategory')}</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      aria-label={t('itemRemove')}
                      data-testid={`item-remove-${index}`}
                      className="col-span-1 text-sm text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
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
              {receipt.paymentId ? (
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
        onConfirmed={(paymentId) => {
          setConfirmOpen(false);
          router.push(`/payments/${paymentId}`);
        }}
      />

      {/* Attached-receipt finish (Phase 8.15). Mounted only while open — its
          payment fetch shouldn't run for plain confirm flows. */}
      {reconcileOpen && receipt.paymentId && (
        <ReconcileReceiptDialog
          open
          receipt={receipt}
          categories={categories}
          onCancel={() => setReconcileOpen(false)}
          onReconciled={(paymentId) => {
            setReconcileOpen(false);
            router.push(`/payments/${paymentId}`);
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
          onClose={() => setWalkthroughOpen(false)}
          onReceiptUpdated={hydrate}
        />
      )}
    </main>
  );
}
