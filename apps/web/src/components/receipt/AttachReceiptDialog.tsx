'use client';

// Phase 8 · Iteration 8.15 — attach a receipt to an existing transaction
// (design §3). Offers the two LLM-analysed intake paths — upload from this
// device and add from URL — since the whole point is to extract the receipt
// and reconcile it against the transaction (a manually-composed barcode receipt
// has nothing to analyse). The receipt is created already linked to the
// transaction; the review page then runs reconciliation.
//
// Accessibility: dialog semantics, focus moved in on open, Esc/backdrop
// close, labelled URL field with Enter-to-submit, errors via toast; every
// colour has a dark-mode variant.

import { RECEIPT_MAX_FILE_SIZE_BYTES } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { ButtonSpinner } from '@/components/ui/ButtonSpinner';
import { FileCaptureButtons } from '@/components/ui/FileCaptureButtons';
import { useToast } from '@/components/ui/Toast';
import { useReceipts } from '@/lib/receipt/receipt-context';
import type { ReceiptSummary } from '@/lib/receipt/types';
import { useAsyncOperation } from '@/lib/ui';
import { RECEIPT_ACCEPT, uploadRejectionMessage, validateUploadFiles } from '@/lib/upload';

const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 ' +
  'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 ' +
  'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

export interface AttachReceiptDialogProps {
  open: boolean;
  transactionId: string;
  onClose(): void;
  /** The created (linked) receipt — the parent routes to its review. */
  onAttached(receipt: ReceiptSummary): void;
}

export function AttachReceiptDialog({
  open,
  transactionId,
  onClose,
  onAttached,
}: AttachReceiptDialogProps) {
  const t = useTranslations('receipts.attach');
  // Browse/camera labels ride the intake-zone keys — same wording everywhere.
  const uploadT = useTranslations('receipts.upload');
  const tUpload = useTranslations('common.upload');
  const { attachFileToTransaction, attachUrlToTransaction } = useReceipts();
  const { addToast } = useToast();

  const urlRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState('');
  const op = useAsyncOperation<ReceiptSummary>({ scope: 'control' });

  useEffect(() => {
    if (!open) return;
    setUrl('');
    setTimeout(() => dialogRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (op.error && op.error.reason !== 'aborted') {
      addToast('error', op.error.message || t('failed'));
    }
  }, [op.error, addToast, t]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const attach = (create: (signal: AbortSignal) => Promise<ReceiptSummary>) => {
    void op.run(create).then((receipt) => {
      if (receipt !== undefined) onAttached(receipt);
    });
  };

  // Several selected images attach as the pages of ONE receipt (8.22).
  const onFiles = (files: File[]) => {
    // 8.27 — type/size gate before any request.
    const { accepted, rejected } = validateUploadFiles(files, {
      accept: RECEIPT_ACCEPT,
      maxBytes: RECEIPT_MAX_FILE_SIZE_BYTES,
    });
    for (const rejection of rejected) {
      addToast('error', uploadRejectionMessage(tUpload, rejection, RECEIPT_MAX_FILE_SIZE_BYTES));
    }
    if (accepted.length === 0) return;
    attach((signal) => attachFileToTransaction(transactionId, accepted, signal));
  };
  const onUrl = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    attach((signal) => attachUrlToTransaction(transactionId, trimmed, signal));
  };

  if (!open || typeof document === 'undefined') return null;

  const node = (
    <div
      data-testid="attach-receipt-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-gray-900/60 sm:items-center sm:p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="attach-receipt-title"
        tabIndex={-1}
        data-testid="attach-receipt-dialog"
        className="flex w-full max-w-md flex-col gap-3 rounded-t-2xl border border-gray-200 bg-white p-5 shadow-xl outline-none sm:rounded-2xl dark:border-gray-700 dark:bg-gray-800"
      >
        <div className="flex items-center justify-between gap-2">
          <h2
            id="attach-receipt-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            {t('title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            data-testid="attach-receipt-close"
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

        {/* 8.25 — shared capture control; this dialog gains the camera path. */}
        <div className="flex flex-wrap items-center gap-2">
          <FileCaptureButtons
            accept={RECEIPT_ACCEPT}
            multiple
            disabled={op.isLoading}
            onFiles={(files) => onFiles(files)}
            browseLabel={uploadT('browse')}
            cameraLabel={uploadT('camera')}
            testIdPrefix="attach-receipt"
            variant="outline"
            size="md"
          />
          {op.isLoading ? <ButtonSpinner /> : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="attach-receipt-url" className="text-xs text-gray-500 dark:text-gray-400">
            {t('urlLabel')}
          </label>
          <div className="flex gap-2">
            <input
              id="attach-receipt-url"
              ref={urlRef}
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onUrl();
                }
              }}
              placeholder={t('urlPlaceholder')}
              data-testid="attach-receipt-url-input"
              className={inputClass}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={op.isLoading || url.trim().length === 0}
              onClick={onUrl}
              data-testid="attach-receipt-url-submit"
            >
              {op.isLoading ? <ButtonSpinner /> : null}
              {t('urlSubmit')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
