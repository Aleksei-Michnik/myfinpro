'use client';

// Phase 7 · Iteration 7.7 — receipt intake: drag-and-drop / file browse /
// mobile camera capture / URL form. Purely presentational — the actual
// upload calls live in the parent (receipts-client), which passes pending
// state down so every input disables during an in-flight request.

import { useTranslations } from 'next-intl';
import { useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/Button';

export interface ReceiptUploadZoneProps {
  /** Camera shots stage as pages of one receipt (8.22); picker/drop may batch. */
  onFiles(files: File[], source: 'picker' | 'camera'): void;
  onUrl(url: string): void;
  pending?: boolean;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

export function ReceiptUploadZone({ onFiles, onUrl, pending = false }: ReceiptUploadZoneProps) {
  const t = useTranslations('receipts.upload');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState('');

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (pending) return;
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) onFiles(files, 'picker');
  };

  const submitUrl = () => {
    const trimmed = url.trim();
    if (!trimmed || pending) return;
    onUrl(trimmed);
    setUrl('');
  };

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
      aria-label={t('title')}
      data-testid="receipt-upload-zone"
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={t('dropLabel')}
        data-testid="receipt-dropzone"
        data-dragover={dragOver || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !pending && fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !pending) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragOver
            ? 'border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
            : 'border-gray-300 bg-gray-50 hover:border-primary-400 dark:border-gray-600 dark:bg-gray-900/40 dark:hover:border-primary-500'
        } ${pending ? 'pointer-events-none opacity-60' : ''}`}
      >
        <svg
          aria-hidden="true"
          className="h-8 w-8 text-gray-400 dark:text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('dropLabel')}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('formats')}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => fileInputRef.current?.click()}
          data-testid="receipt-browse-button"
        >
          {t('browse')}
        </Button>
        {/* Mobile camera capture — the capture attribute opens the camera
            directly on phones; desktop browsers fall back to a file picker. */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => cameraInputRef.current?.click()}
          data-testid="receipt-camera-button"
        >
          {t('camera')}
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        data-testid="receipt-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files, 'picker');
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="receipt-camera-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files, 'camera');
          e.target.value = '';
        }}
      />

      {/* URL ingestion */}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submitUrl();
        }}
      >
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('urlPlaceholder')}
          disabled={pending}
          data-testid="receipt-url-input"
          className="flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={pending || url.trim().length === 0}
          data-testid="receipt-url-submit"
        >
          {t('urlSubmit')}
        </Button>
      </form>
    </section>
  );
}
