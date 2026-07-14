'use client';

// Phase 8.19 — the payment's Documents panel: the linked receipt as a
// viewable document. Uploaded files open in the shared ReceiptDocumentViewer;
// URL receipts link out. Read access is granted to any payment co-viewer,
// group members see it too.

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { ReceiptDocumentViewer } from '@/components/receipt/ReceiptDocumentViewer';
import { InlineErrorBanner } from '@/components/ui/InlineErrorBanner';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { ReceiptSummary } from '@/lib/receipt/types';
import { useAsyncOperation } from '@/lib/ui';

interface PaymentDocumentsProps {
  receiptId: string;
}

export function PaymentDocuments({ receiptId }: PaymentDocumentsProps) {
  const t = useTranslations('payments.documents');
  const { getReceipt, fetchFileBlob } = useReceipts();
  const [receipt, setReceipt] = useState<ReceiptSummary | null>(null);
  const loadOp = useAsyncOperation<ReceiptSummary>({ scope: 'container' });
  const [viewerOpen, setViewerOpen] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const load = useCallback(() => {
    void loadOp
      .run((signal) => getReceipt(receiptId, signal))
      .then((r) => {
        if (r !== undefined) setReceipt(r);
      });
    // loadOp identity is stable (useAsyncOperation contract).
  }, [getReceipt, receiptId]);

  useEffect(() => load(), [load]);

  // Fetch the file blob only once the viewer is opened (uploaded receipts).
  useEffect(() => {
    if (!viewerOpen || !receipt || receipt.source === 'url') return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void fetchFileBlob(receipt.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        /* the viewer shows its own loading state; failure is best-effort */
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [viewerOpen, receipt, fetchFileBlob]);

  const notAccessible =
    !!loadOp.error && (loadOp.error.httpStatus === 404 || loadOp.error.httpStatus === 403);
  const title = receipt
    ? (receipt.merchantName ?? receipt.extractedMerchantName ?? receipt.originalName ?? t('title'))
    : t('title');

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"
      aria-labelledby="payment-documents-title"
      data-testid="payment-documents"
    >
      <h2
        id="payment-documents-title"
        className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100"
      >
        {t('title')}
      </h2>

      {loadOp.isLoading ? (
        <div
          className="flex justify-center py-2"
          role="status"
          aria-label={t('loading')}
          data-testid="payment-documents-loading"
        >
          <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-primary-600" />
        </div>
      ) : notAccessible ? (
        <p
          className="text-sm text-gray-500 dark:text-gray-400"
          data-testid="payment-documents-unavailable"
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
          data-testid="payment-document-external"
        >
          {receipt.sourceUrl} ↗
        </a>
      ) : receipt && receipt.mimeType ? (
        <div
          className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 dark:border-gray-700"
          data-testid="payment-document-file"
        >
          <div className="min-w-0">
            <p className="truncate text-sm text-gray-900 dark:text-gray-100">
              {receipt.originalName ?? t('title')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{receipt.mimeType}</p>
          </div>
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            data-testid="payment-document-view"
          >
            {t('view')}
          </button>
        </div>
      ) : (
        <p
          className="text-sm text-gray-500 dark:text-gray-400"
          data-testid="payment-documents-none"
        >
          {t('none')}
        </p>
      )}

      {receipt && receipt.source !== 'url' && (
        <ReceiptDocumentViewer
          open={viewerOpen}
          url={blobUrl}
          mimeType={receipt.mimeType}
          title={title}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </section>
  );
}
