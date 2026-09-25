'use client';

// The ✕ of a dialog header. Its own component so <Dialog> itself needs no
// translation context: only dialogs that show the ✕ (the `sheet` variant) pull
// `ui.dialog.close` in.

import { useTranslations } from 'next-intl';

export interface DialogCloseButtonProps {
  onClick(): void;
  testId: string;
}

export function DialogCloseButton({ onClick, testId }: DialogCloseButtonProps) {
  const t = useTranslations('ui.dialog');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('close')}
      data-testid={testId}
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
  );
}
