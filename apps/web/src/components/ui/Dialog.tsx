'use client';

// Phase 20 · Iteration 20.1 — THE modal shell. Every dialog in the app is this
// component: the backdrop, the panel, the heading and the behaviour
// (`useDialogBehaviour`: scroll lock, ESC, focus trap, focus restore) live
// here once, so the 22 hand-rolled shells that preceded it cannot drift.
//
// Two looks, both of which existed before the extraction:
//   • `panel` (default) — centred card on a dimmed backdrop; footer Cancel is
//     the close affordance.
//   • `sheet` — bottom sheet on a phone, centred card from `sm:` up; its
//     header carries the ✕ (receipt / product surfaces).
// Full-screen surfaces with their own chrome (`DocumentViewer`,
// `BarcodeScannerDialog`) use `useDialogBehaviour` directly — never a second
// copy of the effects.

import type { KeyboardEventHandler, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { DialogCloseButton } from './DialogCloseButton';
import { cx } from './styles';
import { useDialogBehaviour } from '@/lib/ui';

export type DialogSize = 'sm' | 'md' | 'lg' | 'full';
export type DialogVariant = 'panel' | 'sheet';

const SIZES: Record<DialogSize, string> = {
  sm: 'w-full max-w-sm',
  md: 'w-full max-w-md',
  lg: 'w-full max-w-lg',
  full: 'h-full w-full max-w-none',
};

export interface DialogProps {
  open: boolean;
  onClose(): void;
  /** Heading content. Omit and pass `labelledBy` when the caller renders its own. */
  title?: ReactNode;
  /** Id put on the heading; defaults to `<testId>-title`. */
  titleId?: string;
  /** Id of an external label when `title` is not used. */
  labelledBy?: string;
  /** Literal label when there is no heading element to point at. */
  ariaLabel?: string;
  /** Id of the descriptive text, for `aria-describedby`. */
  describedBy?: string;
  size?: DialogSize;
  variant?: DialogVariant;
  /** Destructive action — the heading turns red. */
  danger?: boolean;
  /** In-flight — sets `aria-busy` on the dialog. */
  busy?: boolean;
  /** `data-testid` of the dialog; the backdrop gets `<testId>-backdrop`. */
  testId: string;
  /** Override for the backdrop's `data-testid`. */
  backdropTestId?: string;
  /** Override for the ✕'s `data-testid`. */
  closeTestId?: string;
  /** Rendered under the body, separated from it by the caller's own spacing. */
  footer?: ReactNode;
  /** Close on a backdrop press (default `true`). */
  closeOnBackdrop?: boolean;
  /** Focused on open; defaults to the dialog element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Header ✕. Defaults to `true` for `sheet`, `false` for `panel`. */
  showClose?: boolean;
  /** Stacks above another dialog (`z-[60]`). */
  stacked?: boolean;
  /** Extra classes on the panel. */
  className?: string;
  /** Extra classes on the heading row. */
  headerClassName?: string;
  /** Key handling owned by the surface (keyboard-first dialogs). */
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  titleId,
  labelledBy,
  ariaLabel,
  describedBy,
  size = 'md',
  variant = 'panel',
  danger = false,
  busy = false,
  testId,
  backdropTestId,
  closeTestId,
  footer,
  closeOnBackdrop = true,
  initialFocusRef,
  showClose,
  stacked = false,
  className = '',
  headerClassName = '',
  onKeyDown,
  children,
}: DialogProps) {
  const { dialogRef } = useDialogBehaviour<HTMLDivElement>({ open, onClose, initialFocusRef });

  if (!open || typeof document === 'undefined') return null;

  const isSheet = variant === 'sheet';
  const withClose = showClose ?? isSheet;
  const headingId = title ? (titleId ?? `${testId}-title`) : undefined;
  const labelId = headingId ?? labelledBy;

  const backdropClass = cx(
    'fixed inset-0 flex justify-center',
    stacked ? 'z-[60]' : 'z-50',
    isSheet
      ? 'items-end bg-gray-900/60 sm:items-center sm:p-4'
      : 'items-center bg-black/50 p-4 sm:p-6',
  );

  const panelClass = cx(
    SIZES[size],
    'bg-white shadow-xl dark:bg-gray-800',
    size === 'full' ? 'rounded-none' : 'rounded-lg',
    isSheet && size !== 'full' && 'rounded-t-2xl sm:rounded-2xl',
    size !== 'full' && 'max-h-[92vh] p-5',
    isSheet
      ? 'flex flex-col gap-3 border border-gray-200 outline-none dark:border-gray-700'
      : 'overflow-y-auto outline-none',
    className,
  );

  const node = (
    <div
      data-testid={backdropTestId ?? `${testId}-backdrop`}
      className={backdropClass}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        aria-label={labelId ? undefined : ariaLabel}
        aria-describedby={describedBy}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid={testId}
        className={panelClass}
      >
        {(title || withClose) && (
          <div
            className={cx(
              'flex items-start justify-between gap-2',
              !isSheet && 'mb-4',
              headerClassName,
            )}
          >
            {title ? (
              <h2
                id={headingId}
                className={cx(
                  'text-lg font-semibold',
                  danger ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100',
                )}
              >
                {title}
              </h2>
            ) : (
              <span />
            )}
            {withClose && (
              <DialogCloseButton onClick={onClose} testId={closeTestId ?? `${testId}-close`} />
            )}
          </div>
        )}
        {children}
        {footer}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
