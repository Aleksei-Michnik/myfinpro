'use client';

// Phase 8.18 — foldable "purchase details" on the transaction view: the linked
// receipt's products/services, lazy-loaded the first time the section is
// expanded. Accessible disclosure (a button with aria-expanded/aria-controls
// toggling a labelled panel). Read-only — editing stays on the receipt review
// page, reachable via the "view receipt" link.

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useId, useRef, useState } from 'react';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { Link } from '@/i18n/navigation';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { ReceiptSummary } from '@/lib/receipt/types';
import { formatAmount } from '@/lib/transaction/formatters';
import { useAsyncOperation } from '@/lib/ui';

interface TransactionPurchaseDetailsProps {
  receiptId: string;
  /** Transaction currency — item amounts are rendered in it. */
  currency: string;
}

export function TransactionPurchaseDetails({
  receiptId,
  currency,
}: TransactionPurchaseDetailsProps) {
  const t = useTranslations('transactions.detail');
  const locale = useLocale();
  const { getReceipt } = useReceipts();
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptSummary | null>(null);
  const loadOp = useAsyncOperation<ReceiptSummary>({ scope: 'container' });
  const panelId = useId();
  // Fetch exactly once, on first expand (retries go through the banner).
  const startedRef = useRef(false);

  const loadReceipt = useCallback(() => {
    startedRef.current = true;
    void loadOp
      .run((signal) => getReceipt(receiptId, signal))
      .then((r) => {
        if (r !== undefined) setReceipt(r);
      });
    // loadOp identity is stable (useAsyncOperation contract).
  }, [getReceipt, receiptId]);

  const toggle = useCallback(() => {
    setOpen((o) => !o);
    if (!startedRef.current) loadReceipt();
  }, [loadReceipt]);

  // A receipt is private to its uploader; a co-viewer of a shared transaction may
  // not be able to read it (404/403). Treat that as "no details to show" here
  // rather than a hard error.
  const notAccessible =
    !!loadOp.error && (loadOp.error.httpStatus === 404 || loadOp.error.httpStatus === 403);

  const receiptLink = (
    <Link
      href={`/receipts/${receiptId}`}
      className="mt-3 inline-block text-sm text-primary-700 hover:underline dark:text-primary-300"
      data-testid="purchase-details-receipt-link"
    >
      {t('receiptLink')}
    </Link>
  );

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
      data-testid="transaction-purchase-details"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="purchase-details-toggle"
        className="flex w-full items-center justify-between gap-2 rounded-lg px-5 py-4 text-start focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
      >
        <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('purchaseTitle')}
        </span>
        <span
          aria-hidden="true"
          className={`text-gray-400 transition-transform dark:text-gray-500 ${open ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          className="border-t border-gray-100 px-5 py-4 dark:border-gray-700"
          data-testid="purchase-details-panel"
        >
          {loadOp.isLoading ? (
            <div
              className="flex justify-center py-4"
              role="status"
              aria-label={t('purchaseLoading')}
              data-testid="purchase-details-loading"
            >
              <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary-600" />
            </div>
          ) : notAccessible ? (
            <p
              className="text-sm text-gray-500 dark:text-gray-400"
              data-testid="purchase-details-unavailable"
            >
              {t('purchaseUnavailable')}
            </p>
          ) : loadOp.error ? (
            <InlineErrorBanner
              reason={loadOp.error.reason}
              httpStatus={loadOp.error.httpStatus}
              onRetry={loadReceipt}
            />
          ) : receipt && receipt.items.length > 0 ? (
            <>
              <ul
                className="divide-y divide-gray-100 dark:divide-gray-700"
                data-testid="purchase-details-items"
              >
                {receipt.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3 py-2"
                    data-testid="purchase-details-item"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-gray-900 dark:text-gray-100">
                        {item.productName ?? item.rawName}
                        {item.productBrand && (
                          <span className="text-gray-400 dark:text-gray-500">
                            {' '}
                            · {item.productBrand}
                          </span>
                        )}
                      </p>
                      {(item.quantity !== 1 || item.unitPriceCents !== null) && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {item.quantity}
                          {item.unitPriceCents !== null
                            ? ` × ${formatAmount(item.unitPriceCents, currency, locale)}`
                            : ''}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-sm tabular-nums text-gray-700 dark:text-gray-300">
                      {formatAmount(item.totalCents, currency, locale)}
                    </span>
                  </li>
                ))}
              </ul>
              {receiptLink}
            </>
          ) : (
            <>
              <p
                className="text-sm text-gray-500 dark:text-gray-400"
                data-testid="purchase-details-empty"
              >
                {t('purchaseEmpty')}
              </p>
              {receiptLink}
            </>
          )}
        </div>
      )}
    </section>
  );
}
