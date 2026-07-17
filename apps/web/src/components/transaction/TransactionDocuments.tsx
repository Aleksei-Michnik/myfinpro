'use client';

// Phase 8.19 — the transaction's Documents panel: the linked receipt as a
// viewable document. Uploaded files open in the shared ReceiptDocumentViewer;
// URL receipts link out. Read access is granted to any transaction co-viewer,
// group members see it too.

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ReceiptDocumentViewer } from '@/components/receipt/ReceiptDocumentViewer';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { ReceiptSummary } from '@/lib/receipt/types';
import { useAsyncOperation } from '@/lib/ui';

interface TransactionDocumentsProps {
  receiptId: string;
}

export function TransactionDocuments({ receiptId }: TransactionDocumentsProps) {
  const t = useTranslations('transactions.documents');
  const { getReceipt, fetchFileBlob } = useReceipts();
  const [receipt, setReceipt] = useState<ReceiptSummary | null>(null);
  const loadOp = useAsyncOperation<ReceiptSummary>({ scope: 'container' });
  const [viewerOpen, setViewerOpen] = useState(false);
  // One object-URL per stored page (8.22), aligned with receipt.files.
  const [blobUrls, setBlobUrls] = useState<(string | null)[]>([]);
  const [blobError, setBlobError] = useState(false);

  const load = useCallback(() => {
    void loadOp
      .run((signal) => getReceipt(receiptId, signal))
      .then((r) => {
        if (r !== undefined) setReceipt(r);
      });
    // loadOp identity is stable (useAsyncOperation contract).
  }, [getReceipt, receiptId]);

  useEffect(() => load(), [load]);

  // Fetch the page blobs only once the viewer is opened (uploaded receipts).
  // Failure surfaces IN the viewer — a silent catch here left it spinning
  // forever. Close + reopen retries.
  useEffect(() => {
    if (!viewerOpen || !receipt || receipt.source === 'url' || receipt.files.length === 0) return;
    setBlobError(false);
    const objectUrls: string[] = [];
    let cancelled = false;
    void Promise.all(receipt.files.map((file) => fetchFileBlob(receipt.id, file.id)))
      .then((blobs) => {
        if (cancelled) return;
        const urls = blobs.map((blob) => URL.createObjectURL(blob));
        objectUrls.push(...urls);
        setBlobUrls(urls);
      })
      .catch(() => {
        if (!cancelled) setBlobError(true);
      });
    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
      setBlobUrls([]);
    };
  }, [viewerOpen, receipt, fetchFileBlob]);

  const notAccessible =
    !!loadOp.error && (loadOp.error.httpStatus === 404 || loadOp.error.httpStatus === 403);
  // Title the viewer with the FILE NAME (language-neutral, matches the row
  // the user clicked) — merchant names are receipt data in the receipt's own
  // language and read as a localisation bug when they lead.
  const title = receipt
    ? (receipt.originalName ?? receipt.merchantName ?? receipt.extractedMerchantName ?? t('title'))
    : t('title');

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"
      aria-labelledby="transaction-documents-title"
      data-testid="transaction-documents"
    >
      <h2
        id="transaction-documents-title"
        className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100"
      >
        {t('title')}
      </h2>

      {loadOp.isLoading ? (
        <div
          className="flex justify-center py-2"
          role="status"
          aria-label={t('loading')}
          data-testid="transaction-documents-loading"
        >
          <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-primary-600" />
        </div>
      ) : notAccessible ? (
        <p
          className="text-sm text-gray-500 dark:text-gray-400"
          data-testid="transaction-documents-unavailable"
        >
          {t('unavailable')}
        </p>
      ) : loadOp.error ? (
        <InlineErrorBanner
          reason={loadOp.error.reason}
          httpStatus={loadOp.error.httpStatus}
          onRetry={load}
        />
      ) : receipt && receipt.source === 'url' && receipt.sourceUrl ? (
        <a
          href={receipt.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 break-all text-sm text-primary-700 hover:underline dark:text-primary-300"
          data-testid="transaction-document-external"
        >
          {receipt.sourceUrl} ↗
        </a>
      ) : receipt && receipt.files.length > 0 ? (
        <div
          className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 dark:border-gray-700"
          data-testid="transaction-document-file"
        >
          <div className="min-w-0">
            <p className="truncate text-sm text-gray-900 dark:text-gray-100">
              {receipt.originalName ?? t('title')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {receipt.files[0].mimeType}
              {receipt.files.length > 1 ? ` · ${t('pages', { count: receipt.files.length })}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            data-testid="transaction-document-view"
          >
            {t('view')}
          </button>
        </div>
      ) : (
        <p
          className="text-sm text-gray-500 dark:text-gray-400"
          data-testid="transaction-documents-none"
        >
          {t('none')}
        </p>
      )}

      {receipt && receipt.source !== 'url' && (
        <ReceiptDocumentViewer
          open={viewerOpen}
          pages={receipt.files.map((file, index) => ({
            url: blobUrls[index] ?? null,
            mimeType: file.mimeType,
          }))}
          loadError={blobError}
          title={title}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </section>
  );
}
