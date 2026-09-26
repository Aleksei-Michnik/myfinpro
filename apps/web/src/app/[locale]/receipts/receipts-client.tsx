'use client';

// Phase 7 · Iteration 7.7 — client orchestrator for the receipts page:
// intake (8.29: the shared `ReceiptIntake` — photo / browse / drop / URL /
// barcodes) + the uploader's receipt list with live lifecycle updates (SSE
// receipt.updated / receipt.deleted, refetch on realtime reconnect per
// docs/ui-realtime-conventions.md).

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExtractionActivity } from '@/components/receipt/ExtractionActivity';
import { LinkTransactionDialog } from '@/components/receipt/LinkTransactionDialog';
import { ManualReceiptDialog } from '@/components/receipt/ManualReceiptDialog';
import { ReceiptIntake } from '@/components/receipt/ReceiptIntake';
import { ReceiptStatusPill } from '@/components/receipt/ReceiptStatusPill';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { Link, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useCategories } from '@/lib/category/category-context';
import type { CategoryDto } from '@/lib/category/types';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { ReceiptSummary } from '@/lib/receipt/types';
import { useAsyncOperation } from '@/lib/ui';

function formatMoney(cents: number, currency: string | null, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency ?? 'USD' }).format(
      cents / 100,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency ?? ''}`.trim();
  }
}

function formatWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function ReceiptsClient() {
  const t = useTranslations('receipts');
  const tLink = useTranslations('receipts.link');
  const locale = useLocale();
  const router = useRouter();
  const { fetchList, retryReceipt, removeReceipt } = useReceipts();
  const { user } = useAuth();
  const { fetchAll } = useCategories();
  const { addToast } = useToast();

  const [receipts, setReceipts] = useState<ReceiptSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  // 8.28 — the receipt whose "link to a transaction" picker is open.
  const [linkingReceipt, setLinkingReceipt] = useState<ReceiptSummary | null>(null);
  // 8.29 — compose a receipt from product barcodes instead of a photo.
  const [barcodesOpen, setBarcodesOpen] = useState(false);

  const listOp = useAsyncOperation<ReceiptSummary[]>({ scope: 'container' });
  const categoriesOp = useAsyncOperation<CategoryDto[]>({ scope: 'control' });
  const rowOp = useAsyncOperation<boolean>({ scope: 'control' });

  const loadFirstPage = useCallback(() => {
    void listOp
      .run(async (signal) => {
        const page = await fetchList({ limit: 20 }, signal);
        setNextCursor(page.nextCursor);
        return page.data;
      })
      .then((data) => {
        if (data !== undefined) setReceipts(data);
      });
    // listOp identity is stable (useAsyncOperation contract).
  }, [fetchList]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  // Gap recovery — any reconnect-after-gap refetches the first page.
  useRealtimeResync(() => {
    loadFirstPage();
  });

  // Live lifecycle updates: replace in place when known, prepend when new.
  useRealtimeEvents({ type: 'receipt.updated' }, (event) => {
    setReceipts((prev) => {
      const index = prev.findIndex((r) => r.id === event.receipt.id);
      if (index === -1) return [event.receipt, ...prev];
      const next = [...prev];
      next[index] = event.receipt;
      return next;
    });
  });
  useRealtimeEvents({ type: 'receipt.deleted' }, (event) => {
    setReceipts((prev) => prev.filter((r) => r.id !== event.receiptId));
  });

  // 8.29 — every create comes back from `ReceiptIntake`: prepend the new
  // rows (dedupe against a realtime event that may have arrived first) and
  // confirm with one toast. Failures are the component's own (toast there).
  const handleCreated = (created: ReceiptSummary[]) => {
    setReceipts((prev) => {
      const known = new Set(prev.map((r) => r.id));
      return [...created.filter((r) => !known.has(r.id)), ...prev];
    });
    addToast('success', t('upload.addedToast', { count: created.length }));
  };

  // The barcode composer needs the user's OUT categories for the products it
  // creates inline; load them once the dialog is asked for.
  useEffect(() => {
    if (!barcodesOpen) return;
    void categoriesOp.run((signal) => fetchAll(signal));
    // categoriesOp identity is stable (useAsyncOperation contract).
  }, [barcodesOpen, fetchAll]);
  const outCategories = useMemo(
    () => (categoriesOp.data ?? []).filter((c) => c.direction !== 'IN'),
    [categoriesOp.data],
  );

  useEffect(() => {
    if (rowOp.error && rowOp.error.reason !== 'aborted') {
      addToast('error', rowOp.error.message || t('list.actionFailed'));
    }
  }, [rowOp.error, addToast, t]);

  const handleRetry = (id: string) => {
    void rowOp
      .run(async (signal) => {
        const updated = await retryReceipt(id, signal);
        setReceipts((prev) => prev.map((r) => (r.id === id ? updated : r)));
        return true;
      })
      .then((r) => {
        if (r !== undefined) addToast('success', t('list.retriedToast'));
      });
  };

  const handleDelete = (id: string) => {
    setConfirmingDelete(null);
    void rowOp
      .run(async (signal) => {
        await removeReceipt(id, signal);
        setReceipts((prev) => prev.filter((r) => r.id !== id));
        return true;
      })
      .then((r) => {
        if (r !== undefined) addToast('success', t('list.deletedToast'));
      });
  };

  const loadMore = () => {
    if (!nextCursor) return;
    void listOp
      .run(async (signal) => {
        const page = await fetchList({ limit: 20, cursor: nextCursor }, signal);
        setNextCursor(page.nextCursor);
        return page.data;
      })
      .then((data) => {
        if (data !== undefined) {
          setReceipts((prev) => {
            const known = new Set(prev.map((r) => r.id));
            return [...prev, ...data.filter((r) => !known.has(r.id))];
          });
        }
      });
  };

  const title = (receipt: ReceiptSummary): string =>
    receipt.merchantName ??
    receipt.extractedMerchantName ??
    receipt.originalName ??
    receipt.sourceUrl ??
    t('list.untitled');

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <PageHeader title={t('title')} />

      <Card
        as="section"
        padding="sm"
        aria-label={t('upload.title')}
        data-testid="receipt-upload-zone"
      >
        <ReceiptIntake
          target={{ kind: 'standalone' }}
          testIdPrefix="receipt"
          onCreated={handleCreated}
          onScanBarcodes={() => setBarcodesOpen(true)}
        />
      </Card>

      <section aria-label={t('list.title')} data-testid="receipts-list" aria-live="polite">
        {listOp.isLoading && receipts.length === 0 && (
          <div
            className="flex items-center justify-center py-12"
            data-testid="receipts-loading"
            role="status"
          >
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
          </div>
        )}

        {listOp.error && receipts.length === 0 && (
          <div data-testid="receipts-error">
            <InlineErrorBanner
              reason={listOp.error.reason}
              httpStatus={listOp.error.httpStatus}
              onRetry={loadFirstPage}
            />
          </div>
        )}

        {!listOp.isLoading && !listOp.error && receipts.length === 0 && (
          <EmptyState
            bordered={false}
            className="py-12"
            data-testid="receipts-empty"
            title={t('list.empty')}
          />
        )}

        <ul className="space-y-2">
          {receipts.map((receipt) => (
            <Card as="li" padding="sm" key={receipt.id} data-testid={`receipt-row-${receipt.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/receipts/${receipt.id}`}
                    className="block truncate text-sm font-medium text-gray-900 hover:text-primary-700 hover:underline dark:text-gray-100 dark:hover:text-primary-300"
                    data-testid={`receipt-link-${receipt.id}`}
                  >
                    {title(receipt)}
                  </Link>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {formatWhen(receipt.createdAt, locale)}
                    {receipt.totalCents !== null && (
                      <>
                        {' · '}
                        <span className="font-mono">
                          {formatMoney(receipt.totalCents, receipt.currency, locale)}
                        </span>
                      </>
                    )}
                    {receipt.items.length > 0 &&
                      ` · ${t('list.itemCount', { count: receipt.items.length })}`}
                  </p>
                  {receipt.status === 'FAILED' && receipt.failureReason && (
                    <p
                      className="mt-1 text-xs text-red-600 dark:text-red-400"
                      data-testid={`receipt-failure-${receipt.id}`}
                    >
                      {receipt.failureReason}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* 8.26 — live extraction verbs next to the pill. */}
                  {receipt.status === 'EXTRACTING' && (
                    <ExtractionActivity receiptId={receipt.id} variant="inline" />
                  )}
                  <ReceiptStatusPill status={receipt.status} />
                  {receipt.status === 'FAILED' && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={rowOp.isLoading}
                      onClick={() => handleRetry(receipt.id)}
                      data-testid={`receipt-retry-${receipt.id}`}
                    >
                      {t('list.retry')}
                    </Button>
                  )}
                  {/* 8.28 — glue an unattached, data-carrying receipt to an
                      existing transaction (instead of confirming a new one). */}
                  {!receipt.transactionId &&
                    (receipt.status === 'REVIEW' || receipt.status === 'CONFIRMED') && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setLinkingReceipt(receipt)}
                        data-testid={`receipt-link-transaction-${receipt.id}`}
                      >
                        {tLink('link')}
                      </Button>
                    )}
                  {receipt.status !== 'CONFIRMED' &&
                    (confirmingDelete === receipt.id ? (
                      <span className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          disabled={rowOp.isLoading}
                          onClick={() => handleDelete(receipt.id)}
                          data-testid={`receipt-delete-confirm-${receipt.id}`}
                        >
                          {t('list.deleteConfirm')}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setConfirmingDelete(null)}
                          data-testid={`receipt-delete-keep-${receipt.id}`}
                        >
                          {t('list.deleteKeep')}
                        </Button>
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={rowOp.isLoading}
                        onClick={() => setConfirmingDelete(receipt.id)}
                        data-testid={`receipt-delete-${receipt.id}`}
                      >
                        {t('list.delete')}
                      </Button>
                    ))}
                </div>
              </div>
            </Card>
          ))}
        </ul>

        {nextCursor && (
          <div className="mt-4 flex justify-center">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={listOp.isLoading}
              onClick={loadMore}
              data-testid="receipts-load-more"
            >
              {t('list.loadMore')}
            </Button>
          </div>
        )}
      </section>

      {/* 8.29 — compose a receipt by scanning the products themselves.
          Mounted only while open so its product hooks stay off the page. */}
      {barcodesOpen && (
        <ManualReceiptDialog
          open
          defaultCurrency={user?.defaultCurrency ?? 'USD'}
          categories={outCategories}
          onClose={() => setBarcodesOpen(false)}
          onCreated={(receipt) => {
            setBarcodesOpen(false);
            router.push(`/receipts/${receipt.id}`);
          }}
        />
      )}

      {/* 8.28 — link a standalone receipt to an existing transaction. */}
      {linkingReceipt && (
        <LinkTransactionDialog
          open
          receiptId={linkingReceipt.id}
          locale={locale}
          onClose={() => setLinkingReceipt(null)}
          onLinked={(linked) => {
            setLinkingReceipt(null);
            setReceipts((prev) => prev.map((r) => (r.id === linked.id ? linked : r)));
            // A REVIEW receipt still needs reconciling — open its review page,
            // where the reconcile dialog auto-opens. A CONFIRMED one is done.
            if (linked.status === 'REVIEW') {
              router.push(`/receipts/${linked.id}`);
            } else {
              addToast('success', tLink('linkedToast'));
            }
          }}
        />
      )}
    </main>
  );
}
