'use client';

// Phase 7 · Iteration 7.7 — client orchestrator for the receipts page:
// intake (drop / browse / camera / URL) + the uploader's receipt list with
// live lifecycle updates (SSE receipt.updated / receipt.deleted, refetch on
// realtime reconnect per docs/ui-realtime-conventions.md).

import { RECEIPT_MAX_FILES } from '@myfinpro/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReceiptStatusPill } from '@/components/receipt/ReceiptStatusPill';
import { ReceiptUploadZone } from '@/components/receipt/ReceiptUploadZone';
import { Button } from '@/components/ui/Button';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useToast } from '@/components/ui/Toast';
import { Link } from '@/i18n/navigation';
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
  const locale = useLocale();
  const { uploadReceipt, createFromUrl, fetchList, retryReceipt, removeReceipt } = useReceipts();
  const { addToast } = useToast();

  const [receipts, setReceipts] = useState<ReceiptSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  // 8.22 — photos staged as the pages of ONE long receipt before uploading.
  const [staged, setStaged] = useState<File[]>([]);

  const listOp = useAsyncOperation<ReceiptSummary[]>({ scope: 'container' });
  const intakeOp = useAsyncOperation<number>({ scope: 'control' });
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

  const uploadBatches = (batches: File[][]) => {
    void intakeOp
      .run(async (signal) => {
        for (const batch of batches) {
          const created = await uploadReceipt(batch, signal);
          setReceipts((prev) =>
            prev.some((r) => r.id === created.id) ? prev : [created, ...prev],
          );
        }
        return batches.length;
      })
      .then((count) => {
        if (count !== undefined) {
          addToast('success', t('upload.uploadedToast', { count }));
        }
      });
  };

  const stagePages = (files: File[]) => {
    setStaged((prev) => {
      const next = [...prev, ...files];
      if (next.length > RECEIPT_MAX_FILES) {
        addToast('error', t('upload.tooManyPages', { max: RECEIPT_MAX_FILES }));
        return next.slice(0, RECEIPT_MAX_FILES);
      }
      return next;
    });
  };

  // Routing (8.22): PDFs are always standalone receipts; camera shots stage
  // as pages of one long receipt (shoot → add page → … → upload); a multi-
  // image pick stages too so the user chooses one-vs-separate explicitly.
  // A single picked image with an empty tray uploads straight away.
  const handleFiles = (files: File[], source: 'picker' | 'camera') => {
    const pdfs = files.filter((f) => f.type === 'application/pdf');
    const images = files.filter((f) => f.type !== 'application/pdf');
    if (pdfs.length > 0) uploadBatches(pdfs.map((pdf) => [pdf]));
    if (images.length === 0) return;
    if (source === 'picker' && staged.length === 0 && images.length === 1) {
      uploadBatches([images]);
      return;
    }
    stagePages(images);
  };

  const handleUrl = (url: string) => {
    void intakeOp
      .run(async (signal) => {
        const created = await createFromUrl(url, signal);
        setReceipts((prev) => (prev.some((r) => r.id === created.id) ? prev : [created, ...prev]));
        return 1;
      })
      .then((r) => {
        if (r !== undefined) addToast('success', t('upload.urlAddedToast'));
      });
  };

  // Intake failures surface as an error toast (mirrors the 6.18.2 pattern).
  useEffect(() => {
    if (intakeOp.error && intakeOp.error.reason !== 'aborted') {
      addToast('error', intakeOp.error.message || t('upload.failedToast'));
    }
  }, [intakeOp.error, addToast, t]);
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
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h1>

      <ReceiptUploadZone onFiles={handleFiles} onUrl={handleUrl} pending={intakeOp.isLoading} />

      {staged.length > 0 && (
        <StagedPagesTray
          files={staged}
          pending={intakeOp.isLoading}
          onRemove={(index) => setStaged((prev) => prev.filter((_, i) => i !== index))}
          onUploadOne={() => {
            uploadBatches([staged]);
            setStaged([]);
          }}
          onUploadSeparately={() => {
            uploadBatches(staged.map((file) => [file]));
            setStaged([]);
          }}
          onClear={() => setStaged([])}
        />
      )}

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
          <p
            className="py-12 text-center text-sm text-gray-500 dark:text-gray-400"
            data-testid="receipts-empty"
          >
            {t('list.empty')}
          </p>
        )}

        <ul className="space-y-2">
          {receipts.map((receipt) => (
            <li
              key={receipt.id}
              className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
              data-testid={`receipt-row-${receipt.id}`}
            >
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
            </li>
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
    </main>
  );
}

interface StagedPagesTrayProps {
  files: File[];
  pending: boolean;
  onRemove(index: number): void;
  onUploadOne(): void;
  onUploadSeparately(): void;
  onClear(): void;
}

/**
 * 8.22 — the pending pages of one long receipt: thumbnails in shot order,
 * per-page remove, and the one-receipt vs separate-receipts choice. More
 * photos added while the tray is open append to it.
 */
function StagedPagesTray({
  files,
  pending,
  onRemove,
  onUploadOne,
  onUploadSeparately,
  onClear,
}: StagedPagesTrayProps) {
  const t = useTranslations('receipts.upload');
  const urls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(
    () => () => {
      for (const url of urls) URL.revokeObjectURL(url);
    },
    [urls],
  );

  return (
    <section
      className="rounded-lg border border-primary-200 bg-primary-50/50 p-4 dark:border-primary-800 dark:bg-primary-900/10"
      aria-label={t('stagedTitle')}
      data-testid="staged-pages"
    >
      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
        {t('stagedTitle')}{' '}
        <span className="text-gray-500 dark:text-gray-400">
          {t('stagedCount', { count: files.length })}
        </span>
      </p>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('stagedHint')}</p>

      <ul className="mt-3 flex flex-wrap gap-2">
        {files.map((file, index) => (
          <li key={`${file.name}-${index}`} className="relative">
            {/* Blob object-URL — next/image can't consume it. */}
            <img
              src={urls[index]}
              alt={t('pageAlt', { page: index + 1 })}
              className="h-20 w-16 rounded border border-gray-300 object-cover dark:border-gray-600"
              data-testid={`staged-page-${index + 1}`}
            />
            <span className="absolute bottom-0.5 start-0.5 rounded bg-gray-900/70 px-1 text-[10px] leading-4 text-white">
              {index + 1}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => onRemove(index)}
              aria-label={t('removePage', { page: index + 1 })}
              data-testid={`staged-page-remove-${index + 1}`}
              className="absolute -end-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-xs leading-none text-white hover:bg-gray-900 disabled:opacity-40"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={pending}
          onClick={onUploadOne}
          data-testid="staged-upload-one"
        >
          {t('uploadAsOne', { count: files.length })}
        </Button>
        {files.length > 1 && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={onUploadSeparately}
            data-testid="staged-upload-separately"
          >
            {t('uploadSeparately')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={onClear}
          data-testid="staged-clear"
        >
          {t('stagedClear')}
        </Button>
      </div>
    </section>
  );
}
