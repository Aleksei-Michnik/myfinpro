'use client';

// Phase 8 · Iteration 8.6 — camera barcode scanning (design §1.4).
//
// Detection strategy: native BarcodeDetector where available (Chrome,
// Android), otherwise @zxing/browser — dynamic-imported so the ~100KB
// decoder never rides the main bundle for users who never scan. Camera
// denial or absence is NOT an error state: the manual-entry input is always
// present, so the dialog degrades to a keyboard flow (also the AT path).
//
// Accessibility: dialog semantics + focus moved in on open, Esc/backdrop
// close, scan status announced via aria-live, reduced-motion safe (no
// animated overlays).

import { isValidGtin, normalizeGtin } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';

/** GTIN-carrying formats (EAN/UPC/ITF-14). */
const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'];
/** Native detector poll cadence — fast enough to feel live, cheap on CPU. */
const DETECT_INTERVAL_MS = 180;

type ScanPhase = 'starting' | 'scanning' | 'no-camera';

interface DetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

export interface BarcodeScannerDialogProps {
  open: boolean;
  onClose(): void;
  /** Fired once with a checksum-valid GTIN; the dialog closes itself. */
  onDetected(code: string): void;
}

export function BarcodeScannerDialog({ open, onClose, onDetected }: BarcodeScannerDialogProps) {
  const t = useTranslations('products.scanner');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const doneRef = useRef(false);

  const [phase, setPhase] = useState<ScanPhase>('starting');
  const [manualCode, setManualCode] = useState('');
  const [manualError, setManualError] = useState(false);

  const finish = useCallback(
    (code: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDetected(code);
      onClose();
    },
    [onDetected, onClose],
  );

  // Camera + detection lifecycle, torn down on close/unmount.
  useEffect(() => {
    if (!open) return;
    doneRef.current = false;
    setPhase('starting');
    setManualCode('');
    setManualError(false);

    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let zxingControls: { stop(): void } | null = null;
    let cancelled = false;

    const accept = (raw: string | null | undefined) => {
      if (!raw) return;
      const code = normalizeGtin(raw);
      if (isValidGtin(code)) finish(code);
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch {
        if (!cancelled) setPhase('no-camera');
        return;
      }
      if (cancelled || !videoRef.current) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      if (cancelled) return;
      setPhase('scanning');

      const NativeDetector = (
        window as { BarcodeDetector?: new (opts: { formats: string[] }) => DetectorLike }
      ).BarcodeDetector;
      if (NativeDetector) {
        const detector = new NativeDetector({ formats: BARCODE_FORMATS });
        timer = setInterval(() => {
          if (video.readyState < 2) return;
          void detector
            .detect(video)
            .then((results) => accept(results[0]?.rawValue))
            .catch(() => undefined);
        }, DETECT_INTERVAL_MS);
        return;
      }

      // Fallback decoder, loaded only now (design §6 — never in the bundle).
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        zxingControls = await reader.decodeFromVideoElement(video, (result) => {
          accept(result?.getText());
        });
      } catch {
        if (!cancelled) setPhase('no-camera');
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      zxingControls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open, finish]);

  // Esc to close + initial focus.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const submitManual = () => {
    const code = normalizeGtin(manualCode);
    if (!isValidGtin(code)) {
      setManualError(true);
      return;
    }
    finish(code);
  };

  if (!open || typeof document === 'undefined') return null;

  const node = (
    <div
      data-testid="barcode-scanner-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/70 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-scanner-title"
        data-testid="barcode-scanner-dialog"
        className="w-full max-w-md space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
      >
        <div className="flex items-start justify-between gap-2">
          <h2
            id="barcode-scanner-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            {t('title')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            data-testid="barcode-scanner-close"
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

        {phase !== 'no-camera' ? (
          <div className="relative overflow-hidden rounded-lg bg-black">
            {/* Live camera preview — decorative for AT; status is announced below. */}
            <video
              ref={videoRef}
              className="aspect-[4/3] w-full object-cover"
              muted
              playsInline
              aria-hidden="true"
              data-testid="barcode-scanner-video"
            />
            {/* Static reticle (no animation — reduced-motion friendly). */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-8 top-1/2 h-20 -translate-y-1/2 rounded-md border-2 border-white/80"
            />
          </div>
        ) : (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
            data-testid="barcode-scanner-no-camera"
          >
            {t('noCamera')}
          </div>
        )}

        <p role="status" aria-live="polite" className="text-sm text-gray-600 dark:text-gray-400">
          {phase === 'scanning' ? t('scanning') : phase === 'starting' ? t('starting') : ''}
        </p>

        {/* Manual entry — the permanent keyboard/AT path and the OFF-line fallback. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitManual();
          }}
          className="space-y-1"
        >
          <label
            htmlFor="barcode-manual-input"
            className="text-xs font-medium text-gray-500 dark:text-gray-400"
          >
            {t('manualLabel')}
          </label>
          <div className="flex gap-2">
            <input
              id="barcode-manual-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={manualCode}
              onChange={(e) => {
                setManualCode(e.target.value);
                setManualError(false);
              }}
              placeholder="7290000000000"
              aria-invalid={manualError || undefined}
              aria-describedby={manualError ? 'barcode-manual-error' : undefined}
              data-testid="barcode-manual-input"
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <Button type="submit" variant="secondary" size="sm" data-testid="barcode-manual-submit">
              {t('manualSubmit')}
            </Button>
          </div>
          {manualError && (
            <p
              id="barcode-manual-error"
              role="alert"
              className="text-xs text-red-600 dark:text-red-400"
              data-testid="barcode-manual-error"
            >
              {t('manualInvalid')}
            </p>
          )}
        </form>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
