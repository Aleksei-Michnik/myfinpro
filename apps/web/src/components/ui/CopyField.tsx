'use client';

// Phase 20 · Iteration 20.7 — THE read-only value + Copy pair: the kit gap
// noted at 20.1 (invite link, revealed API token, the connector command
// block). Clipboard write with a select-text fallback; feedback is a polite
// `role="status"` line inside the component, never only a toast
// (docs/ui/20.7-connector-tokens.md §4, §9). `InviteLink` is the first
// migration onto it.

import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { Button } from './Button';
import { controlClass } from './input-styles';
import { cx } from './styles';

export interface CopyFieldProps {
  value: string;
  /** Visible label above the field. Omit and pass `ariaLabel` for a hidden one. */
  label?: ReactNode;
  ariaLabel?: string;
  /** Multi-line value (a command block) — renders a `<textarea>` instead of an `<input>`. */
  multiline?: boolean;
  /** Id of an external description (e.g. a warning strip) for `aria-describedby`. */
  describedById?: string;
  /** `data-testid` of the value field. */
  testId: string;
  /** Defaults to `${testId}-copy`. */
  copyTestId?: string;
  /** Defaults to `${testId}-status`. */
  statusTestId?: string;
  /** Override the kit's own `ui.copyField.*` defaults with domain-specific wording. */
  copyLabel?: string;
  copiedLabel?: string;
  copyFailedLabel?: string;
  /** Focus + select the field's content on mount (the show-once reveal). */
  autoFocus?: boolean;
  onCopied?(): void;
  className?: string;
}

const STATUS_RESET_MS = 4000;

export function CopyField({
  value,
  label,
  ariaLabel,
  multiline = false,
  describedById,
  testId,
  copyTestId,
  statusTestId,
  copyLabel,
  copiedLabel,
  copyFailedLabel,
  autoFocus = false,
  onCopied,
  className = '',
}: CopyFieldProps) {
  const t = useTranslations('ui.copyField');
  const fieldId = useId();
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveCopyLabel = copyLabel ?? t('copy');
  const effectiveCopiedLabel = copiedLabel ?? t('copied');
  const effectiveFailedLabel = copyFailedLabel ?? t('copyFailed');

  // Mount-only: the field this runs on is only ever rendered once per reveal,
  // so `autoFocus` cannot change under it.
  useEffect(() => {
    if (!autoFocus) return;
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, []);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const announce = (next: 'copied' | 'failed') => {
    setStatus(next);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setStatus('idle'), STATUS_RESET_MS);
  };

  const handleFocus = (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.select();
  };

  const handleCopy = async () => {
    const clipboard =
      typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null;
    if (clipboard) {
      try {
        await clipboard.writeText(value);
        announce('copied');
        onCopied?.();
        return;
      } catch {
        // fall through to the select-text fallback
      }
    }
    fieldRef.current?.focus();
    fieldRef.current?.select();
    announce('failed');
  };

  const fieldClassName = cx(
    controlClass({ size: 'sm' }),
    'flex-1 font-mono',
    multiline && 'resize-none whitespace-pre overflow-x-auto',
  );
  const effectiveCopyTestId = copyTestId ?? `${testId}-copy`;
  const effectiveStatusTestId = statusTestId ?? `${testId}-status`;

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={fieldId}
          className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {label}
        </label>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        {multiline ? (
          <textarea
            ref={fieldRef as Ref<HTMLTextAreaElement>}
            id={fieldId}
            readOnly
            dir="ltr"
            spellCheck={false}
            rows={Math.max(2, value.split('\n').length)}
            value={value}
            aria-label={label ? undefined : ariaLabel}
            aria-describedby={describedById}
            onFocus={handleFocus}
            data-testid={testId}
            className={fieldClassName}
          />
        ) : (
          <input
            ref={fieldRef as Ref<HTMLInputElement>}
            id={fieldId}
            type="text"
            readOnly
            dir="ltr"
            spellCheck={false}
            value={value}
            aria-label={label ? undefined : ariaLabel}
            aria-describedby={describedById}
            onFocus={handleFocus}
            data-testid={testId}
            className={fieldClassName}
          />
        )}
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={() => void handleCopy()}
          className="w-full sm:w-auto"
          data-testid={effectiveCopyTestId}
        >
          {effectiveCopyLabel}
        </Button>
      </div>
      <p
        role="status"
        aria-live="polite"
        data-testid={effectiveStatusTestId}
        className={cx(
          'mt-1 min-h-4 text-xs',
          status === 'failed'
            ? 'text-amber-700 dark:text-amber-400'
            : 'text-gray-500 dark:text-gray-400',
        )}
      >
        {status === 'copied' && effectiveCopiedLabel}
        {status === 'failed' && effectiveFailedLabel}
      </p>
    </div>
  );
}
