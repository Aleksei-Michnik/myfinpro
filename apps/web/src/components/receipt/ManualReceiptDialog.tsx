'use client';

// Phase 8 · Iteration 8.14 — compose a receipt by scanning the products
// themselves (design: docs/phase-8-receipt-intake-design.md §2). For
// purchases without a scannable/linkable slip: each scanned GTIN resolves
// to a registry product (or creates one), and becomes a line
// (product × quantity × unit price). Price memory: re-scanning a product
// bumps its quantity; a product's last purchase price prefills the unit
// price. Submit posts /receipts/manual, born in REVIEW with items
// pre-linked, and hands off to the same review → confirm → transaction pipeline.
//
// Accessibility: dialog semantics, focus moved in on open, Esc/backdrop
// close (suppressed while a sub-dialog is up), scan feedback announced via
// aria-live; every colour has a dark-mode variant; no motion required.

import { CURRENCY_CODES, isValidGtin, normalizeGtin } from '@myfinpro/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarcodeScannerDialog } from '../product/BarcodeScannerDialog';
import { ProductFormDialog } from '../product/ProductFormDialog';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { useToast } from '@/components/ui/Toast';
import { localInputToIso, nowLocalIso } from '@/lib/datetime';
import { useProducts } from '@/lib/product/product-context';
import type { ProductSummary } from '@/lib/product/types';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { ManualReceiptInput, ReceiptSummary } from '@/lib/receipt/types';
import { formatAmount } from '@/lib/transaction/formatters';
import type { CategoryDto } from '@/lib/transaction/types';
import { useAsyncOperation } from '@/lib/ui';

const inputClass =
  'rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 ' +
  'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 ' +
  'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

/** One composed line. Quantity/price are edited as strings, parsed on use. */
interface ManualLine {
  /** Stable React key (product ids are unique per line). */
  productId: string;
  name: string;
  brand: string | null;
  quantityStr: string;
  unitPriceStr: string;
}

/** "45.90" → 4590; empty/invalid/negative → null (Number('') is 0, not NaN). */
function toCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Positive quantity or null. */
function toQuantity(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const centsToInput = (cents: number | null): string =>
  cents === null ? '' : (cents / 100).toFixed(2);

function lineTotalCents(line: ManualLine): number | null {
  const qty = toQuantity(line.quantityStr);
  const price = toCents(line.unitPriceStr);
  if (qty === null || price === null) return null;
  return Math.round(qty * price);
}

export interface ManualReceiptDialogProps {
  open: boolean;
  /** Prefills the currency select (the user's default). */
  defaultCurrency: string;
  /** Visible OUT categories — passed through to inline product creation. */
  categories: CategoryDto[];
  onClose(): void;
  /** The created REVIEW receipt — the parent routes to its review. */
  onCreated(receipt: ReceiptSummary): void;
}

export function ManualReceiptDialog({
  open,
  defaultCurrency,
  categories,
  onClose,
  onCreated,
}: ManualReceiptDialogProps) {
  const t = useTranslations('receipts.manual');
  const locale = useLocale();
  const { lookupBarcode, fetchPurchases } = useProducts();
  const { createManual } = useReceipts();
  const { addToast } = useToast();

  const [currency, setCurrency] = useState(defaultCurrency);
  const [merchantName, setMerchantName] = useState('');
  const [purchasedAt, setPurchasedAt] = useState(nowLocalIso());
  const [lines, setLines] = useState<ManualLine[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingBarcode, setPendingBarcode] = useState<string | undefined>(undefined);
  const [announce, setAnnounce] = useState('');

  const createOp = useAsyncOperation<ReceiptSummary>({ scope: 'control' });
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setCurrency(defaultCurrency);
    setMerchantName('');
    setPurchasedAt(nowLocalIso());
    setLines([]);
    setScannerOpen(false);
    setCreateOpen(false);
    setPendingBarcode(undefined);
    setAnnounce('');
    setTimeout(() => dialogRef.current?.focus(), 0);
  }, [open, defaultCurrency]);

  useEffect(() => {
    if (createOp.error && createOp.error.reason !== 'aborted') {
      addToast('error', createOp.error.message || t('createFailed'));
    }
  }, [createOp.error, addToast, t]);

  const sortedCurrencies = [currency, ...[...CURRENCY_CODES].filter((c) => c !== currency).sort()];

  /** Add a product as a line, or bump its quantity if already present. */
  const addProduct = useCallback(
    (product: Pick<ProductSummary, 'id' | 'name' | 'brand'>) => {
      setLines((prev) => {
        const existing = prev.find((l) => l.productId === product.id);
        if (existing) {
          // Same product re-scanned → increment quantity, keep the price.
          setAnnounce(t('announceIncremented', { name: product.name }));
          return prev.map((l) =>
            l.productId === product.id
              ? { ...l, quantityStr: String((toQuantity(l.quantityStr) ?? 0) + 1) }
              : l,
          );
        }
        setAnnounce(t('announceAdded', { name: product.name }));
        return [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            brand: product.brand,
            quantityStr: '1',
            unitPriceStr: '',
          },
        ];
      });
      // Cross-session price memory: prefill the unit price from the product's
      // most recent purchase (best-effort — never blocks adding the line).
      void fetchPurchases(product.id)
        .then((res) => {
          const recent = [...res.merchants]
            .sort((a, b) => b.lastPurchasedAt.localeCompare(a.lastPurchasedAt))
            .find((m) => m.lastUnitPriceCents !== null);
          if (!recent?.lastUnitPriceCents) return;
          setLines((prev) =>
            prev.map((l) =>
              l.productId === product.id && l.unitPriceStr === ''
                ? { ...l, unitPriceStr: centsToInput(recent.lastUnitPriceCents) }
                : l,
            ),
          );
        })
        .catch(() => undefined);
    },
    [fetchPurchases, t],
  );

  const onScanDetected = (code: string) => {
    const gtin = normalizeGtin(code);
    if (!isValidGtin(gtin)) return;
    void lookupBarcode(gtin)
      .then((res) => {
        if (res.found && res.product) {
          addProduct(res.product);
          return;
        }
        // Unknown barcode → create it (OFF prefill / manual entry inside).
        setPendingBarcode(gtin);
        setCreateOpen(true);
      })
      .catch(() => addToast('error', t('lookupFailed')));
  };

  const updateLine = (productId: string, patch: Partial<ManualLine>) =>
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));

  const removeLine = (productId: string) =>
    setLines((prev) => prev.filter((l) => l.productId !== productId));

  const totalCents = lines.reduce((sum, l) => sum + (lineTotalCents(l) ?? 0), 0);
  const allLinesValid = lines.length > 0 && lines.every((l) => lineTotalCents(l) !== null);

  const submit = () => {
    if (!allLinesValid || createOp.isLoading) return;
    const input: ManualReceiptInput = {
      currency,
      merchantName: merchantName.trim() || undefined,
      purchasedAt: localInputToIso(purchasedAt),
      items: lines.map((l) => ({
        productId: l.productId,
        quantity: toQuantity(l.quantityStr)!,
        unitPriceCents: toCents(l.unitPriceStr)!,
      })),
    };
    void createOp
      .run((signal) => createManual(input, signal))
      .then((receipt) => {
        if (receipt !== undefined) onCreated(receipt);
      });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !scannerOpen && !createOpen) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, scannerOpen, createOpen]);

  if (!open || typeof document === 'undefined') return null;

  const node = (
    <div
      data-testid="manual-receipt-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-gray-900/60 sm:items-center sm:p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-receipt-title"
        tabIndex={-1}
        data-testid="manual-receipt-dialog"
        className="flex max-h-[92vh] w-full max-w-lg flex-col gap-3 rounded-t-2xl border border-gray-200 bg-white p-5 shadow-xl outline-none sm:rounded-2xl dark:border-gray-700 dark:bg-gray-800"
      >
        <div className="flex items-center justify-between gap-2">
          <h2
            id="manual-receipt-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            {t('title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            data-testid="manual-receipt-close"
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

        <p className="text-xs text-gray-500 dark:text-gray-400">{t('hint')}</p>

        {/* Header fields */}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
            <span>{t('currency')}</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              data-testid="manual-receipt-currency"
              className={`mt-1 ${inputClass}`}
            >
              {sortedCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
            <span>{t('purchasedAt')}</span>
            <input
              type="datetime-local"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
              data-testid="manual-receipt-date"
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="col-span-2 flex flex-col text-xs text-gray-500 dark:text-gray-400">
            <span>{t('merchant')}</span>
            <input
              type="text"
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              maxLength={200}
              placeholder={t('merchantPlaceholder')}
              data-testid="manual-receipt-merchant"
              className={`mt-1 ${inputClass}`}
            />
          </label>
        </div>

        {/* Lines */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {lines.length === 0 ? (
            <p
              className="py-6 text-center text-sm text-gray-500 dark:text-gray-400"
              data-testid="manual-receipt-empty"
            >
              {t('empty')}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="manual-receipt-lines">
              {lines.map((line) => {
                const total = lineTotalCents(line);
                return (
                  <li
                    key={line.productId}
                    className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700"
                    data-testid={`manual-receipt-line-${line.productId}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                          {line.name}
                        </p>
                        {line.brand && (
                          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                            {line.brand}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(line.productId)}
                        aria-label={t('removeLine', { name: line.name })}
                        data-testid={`manual-receipt-remove-${line.productId}`}
                        className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:hover:bg-gray-700"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
                        <span>{t('quantity')}</span>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          inputMode="decimal"
                          value={line.quantityStr}
                          onChange={(e) =>
                            updateLine(line.productId, { quantityStr: e.target.value })
                          }
                          aria-label={t('quantityFor', { name: line.name })}
                          data-testid={`manual-receipt-qty-${line.productId}`}
                          className={`mt-1 w-20 ${inputClass}`}
                        />
                      </label>
                      <label className="flex flex-col text-xs text-gray-500 dark:text-gray-400">
                        <span>{t('unitPrice')}</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          value={line.unitPriceStr}
                          onChange={(e) =>
                            updateLine(line.productId, { unitPriceStr: e.target.value })
                          }
                          aria-label={t('unitPriceFor', { name: line.name })}
                          data-testid={`manual-receipt-price-${line.productId}`}
                          className={`mt-1 w-24 ${inputClass}`}
                        />
                      </label>
                      <span className="ml-auto pb-1.5 text-sm font-medium text-gray-900 tabular-nums dark:text-gray-100">
                        {total === null ? '—' : formatAmount(total, currency, locale)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p aria-live="polite" className="sr-only" data-testid="manual-receipt-announce">
          {announce}
        </p>

        {/* Add products */}
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setScannerOpen(true)}
            data-testid="manual-receipt-scan"
          >
            {t('scan')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setPendingBarcode(undefined);
              setCreateOpen(true);
            }}
            data-testid="manual-receipt-add-product"
          >
            {t('addProduct')}
          </Button>
          <span className="ml-auto text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('total')}{' '}
            <span data-testid="manual-receipt-total" className="tabular-nums">
              {formatAmount(totalCents, currency, locale)}
            </span>
          </span>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={!allLinesValid || createOp.isLoading}
            data-testid="manual-receipt-submit"
          >
            {createOp.isLoading ? <ButtonSpinner /> : null}
            {t('submit')}
          </Button>
        </div>
      </div>

      <BarcodeScannerDialog
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={onScanDetected}
      />
      <ProductFormDialog
        open={createOpen}
        initialBarcode={pendingBarcode}
        categories={categories}
        onCancel={() => setCreateOpen(false)}
        onSaved={(product: ProductSummary) => {
          setCreateOpen(false);
          addProduct(product);
        }}
      />
    </div>
  );

  return createPortal(node, document.body);
}
