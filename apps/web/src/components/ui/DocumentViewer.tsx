'use client';

// Phase 8.18, generalized in 8.27 — THE accessible popup viewer for any
// full-size document (docs/image-handling.md §4): receipt pages (blob object
// URLs) and product pictures (cookie-authed API URLs). Images support zoom
// (buttons / wheel / +-0 keys) and drag-to-pan; PDFs render in the browser's
// native viewer with a download fallback; multi-page documents get a page
// navigator. Portal-mounted, focus-trapped, focus-restored, ESC + backdrop
// close — the dialog pattern used across the app (cf. RetryReturnDialog).

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { swipeDelta } from '@/lib/swipe';
import { useBodyScrollLock } from '@/lib/ui';

/** One page to display — `src` is null while its blob still loads. */
export interface ViewerPage {
  kind: 'image' | 'pdf';
  src: string | null;
  /** File name suggested by the PDF download fallback. */
  downloadName?: string;
}

interface DocumentViewerProps {
  open: boolean;
  /** Pages in display order; a single-file document is one page. */
  pages: ViewerPage[];
  /** Page shown when the viewer opens (defaults to the first). */
  initialIndex?: number;
  /** True when the file(s) failed to load — renders an error instead of the spinner. */
  loadError?: boolean;
  /** Accessible title (e.g. the file or product name). */
  title: string;
  onClose(): void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function DocumentViewer({
  open,
  pages,
  initialIndex = 0,
  loadError = false,
  title,
  onClose,
}: DocumentViewerProps) {
  const t = useTranslations('common.viewer');
  useBodyScrollLock(open);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  // At 1× a horizontal drag pages next/prev (RTL-aware, 8.27); a completed
  // swipe suppresses the click that follows so it never doubles as zoom-in.
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pageIndex, setPageIndex] = useState(0);

  const page = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))] ?? null;
  const url = page?.src ?? null;
  const isImage = page?.kind === 'image';
  const isPdf = page?.kind === 'pdf';

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setScale((s) => {
      const next = clampScale(s + delta);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  // Reset the transform whenever the dialog opens or the page changes;
  // reopening always starts back at the initial page.
  useEffect(() => {
    if (open) reset();
  }, [open, url, reset]);
  useEffect(() => {
    if (open) setPageIndex(Math.min(Math.max(0, initialIndex), Math.max(0, pages.length - 1)));
    // Re-anchor only on open/initialIndex — page flips inside a session must
    // not snap back when the pages array identity changes.
  }, [open, initialIndex]);

  // Snapshot the previously-focused element on open; restore on close.
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      clearTimeout(timer);
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, [open]);

  // ESC + Tab focus trap + image zoom/pan shortcuts.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const root = dialogRef.current;
        if (!root) return;
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute('disabled'));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (!isImage) return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomBy(0.5);
      } else if (e.key === '-') {
        e.preventDefault();
        zoomBy(-0.5);
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      } else if (e.key.startsWith('Arrow') && scale > 1) {
        e.preventDefault();
        const step = 48;
        setOffset((o) => ({
          x: o.x + (e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0),
          y: o.y + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0),
        }));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, isImage, scale, zoomBy, reset]);

  if (!open || typeof document === 'undefined') return null;

  const onWheel = (e: React.WheelEvent) => {
    if (!isImage) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 0.4 : -0.4);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!isImage) return;
    if (scale === 1) {
      // Not zoomed: a horizontal drag pages through a multi-page document.
      if (pages.length > 1) {
        swipeStartRef.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      return;
    }
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
  };
  const endDrag = () => {
    dragRef.current = null;
    swipeStartRef.current = null;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = swipeStartRef.current;
    if (start) {
      const delta = swipeDelta(e.currentTarget, e.clientX - start.x, e.clientY - start.y);
      if (delta !== 0) {
        suppressClickRef.current = true;
        setPageIndex((i) => Math.min(pages.length - 1, Math.max(0, i + delta)));
      }
    }
    endDrag();
  };

  const zoomControls = isImage && (
    <div className="flex items-center gap-1" role="group" aria-label={t('zoomControls')}>
      <button
        type="button"
        onClick={() => zoomBy(-0.5)}
        disabled={scale <= MIN_SCALE}
        aria-label={t('zoomOut')}
        data-testid="viewer-zoom-out"
        className="rounded-md px-2 py-1 text-lg leading-none text-white/90 hover:bg-white/10 disabled:opacity-40"
      >
        −
      </button>
      <span
        className="w-12 text-center text-xs tabular-nums text-white/80"
        data-testid="viewer-zoom-level"
      >
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        onClick={() => zoomBy(0.5)}
        disabled={scale >= MAX_SCALE}
        aria-label={t('zoomIn')}
        data-testid="viewer-zoom-in"
        className="rounded-md px-2 py-1 text-lg leading-none text-white/90 hover:bg-white/10 disabled:opacity-40"
      >
        +
      </button>
      <button
        type="button"
        onClick={reset}
        disabled={scale === 1 && offset.x === 0 && offset.y === 0}
        aria-label={t('reset')}
        data-testid="viewer-zoom-reset"
        className="rounded-md px-2 py-1 text-xs text-white/90 hover:bg-white/10 disabled:opacity-40"
      >
        {t('reset')}
      </button>
    </div>
  );

  const pager = pages.length > 1 && (
    <div className="flex items-center gap-1" role="group" aria-label={t('pageControls')}>
      <button
        type="button"
        onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
        disabled={pageIndex === 0}
        aria-label={t('prevPage')}
        data-testid="viewer-prev-page"
        className="rounded-md px-2 py-1 text-lg leading-none text-white/90 hover:bg-white/10 disabled:opacity-40"
      >
        ‹
      </button>
      <span className="text-xs tabular-nums text-white/80" data-testid="viewer-page-indicator">
        {t('pageOf', { current: pageIndex + 1, total: pages.length })}
      </span>
      <button
        type="button"
        onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}
        disabled={pageIndex >= pages.length - 1}
        aria-label={t('nextPage')}
        data-testid="viewer-next-page"
        className="rounded-md px-2 py-1 text-lg leading-none text-white/90 hover:bg-white/10 disabled:opacity-40"
      >
        ›
      </button>
    </div>
  );

  const node = (
    <div
      data-testid="document-viewer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex flex-col bg-gray-900/80 p-2 sm:p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="document-viewer"
        className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-gray-900 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
          <h2 className="truncate text-sm font-medium text-white/90" data-testid="viewer-title">
            {title}
          </h2>
          <div className="flex items-center gap-2">
            {pager}
            {zoomControls}
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={t('openInNewTab')}
                data-testid="viewer-open-new-tab"
                className="rounded-md px-2 py-1 text-xs text-white/90 hover:bg-white/10"
              >
                ↗
              </a>
            )}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label={t('close')}
              data-testid="viewer-close"
              className="rounded-md px-2 py-1 text-lg leading-none text-white/90 hover:bg-white/10"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden">
          {!url ? (
            loadError ? (
              <div
                className="flex h-full items-center justify-center p-4 text-center text-sm text-red-300"
                role="alert"
                data-testid="viewer-load-error"
              >
                {t('loadFailed')}
              </div>
            ) : (
              <div
                className="flex h-full items-center justify-center text-sm text-white/70"
                role="status"
                data-testid="viewer-loading"
              >
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-white/80" />
              </div>
            )
          ) : isPdf ? (
            <object
              data={url}
              type="application/pdf"
              className="h-full w-full"
              aria-label={title}
              data-testid="viewer-pdf"
            >
              <div className="flex h-full items-center justify-center p-4 text-center text-sm text-white/80">
                <a
                  href={url}
                  download={page?.downloadName ?? true}
                  className="underline"
                  data-testid="viewer-pdf-fallback"
                >
                  {t('downloadPdf')}
                </a>
              </div>
            </object>
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{ touchAction: 'none', cursor: scale > 1 ? 'grab' : 'zoom-in' }}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={endDrag}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                if (scale === 1) zoomBy(1);
              }}
              data-testid="viewer-image-stage"
            >
              {/* Blob object-URL / cookie-authed API URL — next/image can't consume either. */}
              <img
                src={url}
                alt={title}
                draggable={false}
                data-testid="viewer-image"
                className="max-h-full max-w-full select-none object-contain"
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                  transition: dragRef.current ? 'none' : 'transform 120ms ease-out',
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
