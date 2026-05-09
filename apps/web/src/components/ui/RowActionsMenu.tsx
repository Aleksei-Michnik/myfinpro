'use client';

// Phase 6 · Iteration 6.15.1 — reusable row-actions ⋮ dropdown.
//
// Renders a `⋮` trigger button + a portal-rendered popover anchored to it.
// The popover is portalled to `document.body` with `position: fixed`, so no
// ancestor's `overflow: hidden` / `overflow-x: auto` (e.g. the desktop
// payments-table wrapper) can clip it. Coordinates are recomputed on
// `scroll` (capture phase, catches inner scrollers) and `resize`.
//
// Behaviour:
//   - right-edge alignment to the trigger by default
//   - vertical flip when there's no room below
//   - horizontal viewport clamp
//   - click-outside / Escape closes
//   - stopPropagation on trigger so the parent row's navigate-on-click
//     (added in 6.14) doesn't fire

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export interface RowActionsMenuItem {
  key: string;
  label: ReactNode;
  onClick(): void;
  destructive?: boolean;
  disabled?: boolean;
  testId?: string;
}

export interface RowActionsMenuProps {
  /** Accessible label for the ⋮ trigger button. */
  triggerLabel: string;
  items: RowActionsMenuItem[];
  /** Applied to the trigger; popover gets `${testId}-popover`. */
  testId?: string;
  /** Override popover width (px). Defaults to 160 (Tailwind w-40). */
  popoverWidthPx?: number;
}

const DEFAULT_POPOVER_WIDTH = 160;
const ITEM_HEIGHT = 40;
const VIEWPORT_MARGIN = 8;

export function RowActionsMenu({
  triggerLabel,
  items,
  testId,
  popoverWidthPx = DEFAULT_POPOVER_WIDTH,
}: RowActionsMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const computeCoords = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popoverHeight = items.length * ITEM_HEIGHT + 8;

    let top = rect.bottom + VIEWPORT_MARGIN;
    let left = rect.right - popoverWidthPx;

    if (top + popoverHeight > window.innerHeight - VIEWPORT_MARGIN) {
      top = rect.top - popoverHeight - VIEWPORT_MARGIN;
    }
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    if (left + popoverWidthPx > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - popoverWidthPx - VIEWPORT_MARGIN;
    }

    setCoords({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) return;
    computeCoords();
  }, [open, items.length, popoverWidthPx]);

  useEffect(() => {
    if (!open) return;
    const handle = () => computeCoords();
    // Capture phase so scrolls inside an `overflow:auto` ancestor are caught
    // (they don't bubble to window in bubble phase).
    window.addEventListener('scroll', handle, true);
    window.addEventListener('resize', handle);
    return () => {
      window.removeEventListener('scroll', handle, true);
      window.removeEventListener('resize', handle);
    };
  }, [open, items.length, popoverWidthPx]);

  useEffect(() => {
    if (!open) return;
    const onClick = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onTriggerClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    setOpen((p) => !p);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={onTriggerClick}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 5v.01M12 12v.01M12 19v.01"
          />
        </svg>
      </button>
      {open && coords && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              role="menu"
              data-testid={testId ? `${testId}-popover` : undefined}
              style={{ top: coords.top, left: coords.left, position: 'fixed' }}
              className="z-50 rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-800"
              // Width is inlined so the coordinate math matches the actual box.
            >
              <div style={{ width: popoverWidthPx }}>
                {items.map((item) => (
                  <button
                    key={item.key}
                    role="menuitem"
                    type="button"
                    disabled={item.disabled}
                    data-testid={item.testId}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (item.disabled) return;
                      setOpen(false);
                      item.onClick();
                    }}
                    className={`block w-full px-3 py-2 text-start ${
                      item.destructive
                        ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30'
                        : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
