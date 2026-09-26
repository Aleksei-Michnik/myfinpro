'use client';

// Phase 8 · Iteration 8.29 (docs/ui/8.29-receipt-intake.md) — THE receipt
// intake. Everything a user can do to get a receipt into the extract →
// review → confirm pipeline lives here: photograph, browse, drop, paste a
// URL, plus the host's extra methods. It owns the client-side gate
// (lib/upload.ts), the multi-photo staging (8.22), the API call and its
// pending/error state; hosts only say where the receipt goes (`target`)
// and what happens next (`onCreated`). Replaces ReceiptUploadZone and the
// bespoke intakes of AttachReceiptDialog and TransactionFormDialog.

import { RECEIPT_MAX_FILE_SIZE_BYTES, RECEIPT_MAX_FILES } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { StagedPagesTray } from './StagedPagesTray';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { FileCaptureButtons } from '@/components/ui/FileCaptureButtons';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { ReceiptSummary } from '@/lib/receipt/types';
import { useAsyncOperation } from '@/lib/ui';
import { RECEIPT_ACCEPT, uploadRejectionMessage, validateUploadFiles } from '@/lib/upload';

export type ReceiptIntakeTarget =
  | { kind: 'standalone' }
  | { kind: 'transaction'; transactionId: string };

export interface ReceiptIntakeProps {
  target: ReceiptIntakeTarget;
  /** Every successful create. Standalone "upload separately" passes several; transaction always one. */
  onCreated(receipts: ReceiptSummary[]): void;
  /** Host-offered extra methods — the button is rendered only when the handler is given. */
  onScanBarcodes?(): void;
  onLinkExisting?(): void;
  /** Host busy state (e.g. the surrounding form is submitting). Adds to the internal pending state. */
  disabled?: boolean;
  /** Per-surface intro line above the actions (already translated by the host). */
  hint?: string;
  /** data-testid prefix (docs/ui/8.29-receipt-intake.md §1.5). */
  testIdPrefix: string;
}

export function ReceiptIntake({
  target,
  onCreated,
  onScanBarcodes,
  onLinkExisting,
  disabled = false,
  hint,
  testIdPrefix,
}: ReceiptIntakeProps) {
  const t = useTranslations('receipts.intake');
  const tUpload = useTranslations('common.upload');
  const { uploadReceipt, createFromUrl, attachFileToTransaction, attachUrlToTransaction } =
    useReceipts();
  const { addToast } = useToast();

  const urlInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [staged, setStaged] = useState<File[]>([]);

  // One control-scope op for files and URLs alike — the block shows a single
  // spinner and disables everything while it runs.
  const op = useAsyncOperation<ReceiptSummary[]>({ scope: 'control' });
  const pending = op.isLoading;
  const busy = pending || disabled;

  useEffect(() => {
    if (op.error && op.error.reason !== 'aborted') {
      addToast('error', op.error.message || t('failedToast'));
    }
  }, [op.error, addToast, t]);

  // Opening the URL row moves focus into the field.
  useEffect(() => {
    if (urlOpen) urlInputRef.current?.focus();
  }, [urlOpen]);

  const succeed = (receipts: ReceiptSummary[] | undefined, fromTray: boolean) => {
    if (receipts === undefined) return; // failure — state stays so the user can retry
    if (fromTray) setStaged([]);
    setUrl('');
    setUrlOpen(false);
    onCreated(receipts);
  };

  /** One op, sequential creates — `onCreated` fires once with everything created. */
  const createBatches = (batches: File[][], fromTray = false) => {
    void op
      .run(async (signal) => {
        const created: ReceiptSummary[] = [];
        for (const batch of batches) {
          created.push(
            target.kind === 'standalone'
              ? await uploadReceipt(batch, signal)
              : await attachFileToTransaction(target.transactionId, batch, signal),
          );
        }
        return created;
      })
      .then((receipts) => succeed(receipts, fromTray));
  };

  const submitUrl = () => {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    void op
      .run(async (signal) => [
        target.kind === 'standalone'
          ? await createFromUrl(trimmed, signal)
          : await attachUrlToTransaction(target.transactionId, trimmed, signal),
      ])
      .then((receipts) => succeed(receipts, false));
  };

  const stagePages = (images: File[]) => {
    if (staged.length + images.length > RECEIPT_MAX_FILES) {
      addToast('error', t('tooManyPages', { max: RECEIPT_MAX_FILES }));
    }
    // Functional update: two picks landing in one render both keep their pages.
    setStaged((prev) => [...prev, ...images].slice(0, RECEIPT_MAX_FILES));
  };

  /**
   * Routing (8.22, 8.29 §1.2): PDFs are a receipt of their own (a transaction
   * takes one and only when nothing else is pending); camera shots always
   * stage so a long receipt can be photographed page by page; a lone picked
   * image with an empty tray uploads straight away.
   */
  const handleFiles = (raw: File[], source: 'picker' | 'camera') => {
    if (busy) return;
    // The client-side gate (8.27) — drops bypass the input's accept attribute.
    const { accepted, rejected } = validateUploadFiles(raw, {
      accept: RECEIPT_ACCEPT,
      maxBytes: RECEIPT_MAX_FILE_SIZE_BYTES,
    });
    for (const rejection of rejected) {
      addToast('error', uploadRejectionMessage(tUpload, rejection, RECEIPT_MAX_FILE_SIZE_BYTES));
    }
    const pdfs = accepted.filter((file) => file.type === 'application/pdf');
    const images = accepted.filter((file) => file.type !== 'application/pdf');

    if (pdfs.length > 0) {
      if (target.kind === 'standalone') {
        createBatches(pdfs.map((pdf) => [pdf]));
      } else if (accepted.length === 1 && staged.length === 0) {
        // One transaction ↔ one receipt: a PDF is taken only on its own.
        createBatches([pdfs]);
      } else {
        addToast('error', t('pdfAlone'));
      }
    }

    if (images.length === 0) return;
    if (pdfs.length === 0 && source === 'picker' && staged.length === 0 && images.length === 1) {
      createBatches([images]);
      return;
    }
    stagePages(images);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (busy) return;
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) handleFiles(files, 'picker');
  };

  const urlRowId = `${testIdPrefix}-url-row`;

  return (
    <div
      className={`space-y-2 rounded-md border-2 border-dashed px-3 py-2 transition-colors ${
        dragOver
          ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
          : 'border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-900/40'
      }`}
      aria-busy={pending || undefined}
      data-dragover={dragOver || undefined}
      data-testid={`${testIdPrefix}-intake`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {hint && <p className="text-xs text-gray-600 dark:text-gray-300">{hint}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <FileCaptureButtons
          accept={RECEIPT_ACCEPT}
          multiple
          disabled={busy}
          onFiles={handleFiles}
          browseLabel={tUpload('browse')}
          cameraLabel={tUpload('camera')}
          testIdPrefix={testIdPrefix}
          variant="outline"
          size="sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          aria-expanded={urlOpen}
          aria-controls={urlRowId}
          onClick={() => setUrlOpen((open) => !open)}
          data-testid={`${testIdPrefix}-url-toggle`}
        >
          {t('url')}
        </Button>
        {onScanBarcodes && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onScanBarcodes}
            data-testid={`${testIdPrefix}-barcodes`}
          >
            {t('barcodes')}
          </Button>
        )}
        {onLinkExisting && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onLinkExisting}
            data-testid={`${testIdPrefix}-link-existing`}
          >
            {t('linkExisting')}
          </Button>
        )}
        {pending && <ButtonSpinner />}
      </div>

      {/* Drag-and-drop is a pointer affordance — phones never see the line. */}
      <p className="hidden text-xs text-gray-500 dark:text-gray-400 md:block">{t('dropHint')}</p>

      {urlOpen && (
        <div id={urlRowId} className="flex gap-2">
          <Input
            ref={urlInputRef}
            type="url"
            inputMode="url"
            size="sm"
            aria-label={t('urlLabel')}
            placeholder={t('urlPlaceholder')}
            value={url}
            disabled={busy}
            wrapperClassName="flex-1"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds the receipt; it must never submit a host <form>.
              if (e.key === 'Enter') {
                e.preventDefault();
                submitUrl();
              }
            }}
            data-testid={`${testIdPrefix}-url-input`}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || url.trim().length === 0}
            onClick={submitUrl}
            data-testid={`${testIdPrefix}-url-submit`}
          >
            {t('urlSubmit')}
          </Button>
        </div>
      )}

      {staged.length > 0 && (
        <StagedPagesTray
          files={staged}
          pending={busy}
          canUploadSeparately={target.kind === 'standalone'}
          testIdPrefix={testIdPrefix}
          onRemove={(index) => setStaged((prev) => prev.filter((_, i) => i !== index))}
          onUploadOne={() => createBatches([staged], true)}
          onUploadSeparately={() =>
            createBatches(
              staged.map((file) => [file]),
              true,
            )
          }
          onClear={() => setStaged([])}
        />
      )}
    </div>
  );
}
