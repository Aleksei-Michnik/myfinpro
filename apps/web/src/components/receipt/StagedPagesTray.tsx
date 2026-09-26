'use client';

// Phase 8 · Iteration 8.22 — the pending pages of one long receipt:
// thumbnails in shot order, per-page remove, and the one-receipt vs
// separate-receipts choice. Moved out of the receipts page in 8.29 so the
// single intake component (`ReceiptIntake`) owns it on every surface;
// object-URL previews are revoked when the list changes or unmounts
// (docs/image-handling.md §4, "Staged local previews").

import { useTranslations } from 'next-intl';
import { useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/Button';

export interface StagedPagesTrayProps {
  files: File[];
  pending: boolean;
  /** Only a standalone intake can split the staged pages into several receipts. */
  canUploadSeparately: boolean;
  /** data-testids: `<prefix>-staged`, `-staged-page-<n>`, `-staged-remove-<n>`, … */
  testIdPrefix: string;
  onRemove(index: number): void;
  onUploadOne(): void;
  onUploadSeparately(): void;
  onClear(): void;
}

export function StagedPagesTray({
  files,
  pending,
  canUploadSeparately,
  testIdPrefix,
  onRemove,
  onUploadOne,
  onUploadSeparately,
  onClear,
}: StagedPagesTrayProps) {
  const t = useTranslations('receipts.intake');
  const urls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(
    () => () => {
      for (const url of urls) URL.revokeObjectURL(url);
    },
    [urls],
  );

  return (
    <section
      className="rounded-md border border-primary-200 bg-primary-50/50 p-3 dark:border-primary-800 dark:bg-primary-900/10"
      aria-label={t('stagedTitle')}
      data-testid={`${testIdPrefix}-staged`}
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
              data-testid={`${testIdPrefix}-staged-page-${index + 1}`}
            />
            <span className="absolute bottom-0.5 start-0.5 rounded bg-gray-900/70 px-1 text-[10px] leading-4 text-white">
              {index + 1}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => onRemove(index)}
              aria-label={t('removePage', { page: index + 1 })}
              data-testid={`${testIdPrefix}-staged-remove-${index + 1}`}
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
          data-testid={`${testIdPrefix}-staged-upload-one`}
        >
          {t('uploadAsOne', { count: files.length })}
        </Button>
        {canUploadSeparately && files.length > 1 && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={onUploadSeparately}
            data-testid={`${testIdPrefix}-staged-upload-separately`}
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
          data-testid={`${testIdPrefix}-staged-clear`}
        >
          {t('stagedClear')}
        </Button>
      </div>
    </section>
  );
}
