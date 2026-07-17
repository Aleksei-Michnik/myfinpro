'use client';

// Phase 8.26 — live extraction-progress decoration (design §4.4).
//
// Renders wherever the user waits on an UPLOADED/EXTRACTING receipt:
//   - variant="panel"  — the review page's items area (primary wait surface)
//   - variant="inline" — compact line on EXTRACTING receipt-list rows
//
// Fed by the transient `receipt.extraction.progress` SSE event. Everything
// here is component state: thoughts are never persisted anywhere — reload
// forgets them, by design. The stream is advisory: with no events the
// component keeps rotating generic verbs until `receipt.updated` unmounts it.

import { findLlmModel, type ReceiptExtractionProgress } from '@myfinpro/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';

/** Client-side verb rotation cadence while no fresh event arrives. */
const VERB_ROTATION_MS = 2500;
/** Every rotating stage has exactly this many verb variants in messages. */
const VERBS_PER_STAGE = 3;
/** Cap on accumulated reasoning kept in memory (newest tail wins). */
const THOUGHTS_MAX_CHARS = 8000;

/** Stages rendered as rotating verb sets (the rest have data-driven lines). */
type RotatingStage = 'waiting' | 'preparing' | 'processing' | 'thinking' | 'generating';

export function ExtractionActivity({
  receiptId,
  variant,
}: {
  receiptId: string;
  variant: 'panel' | 'inline';
}) {
  const t = useTranslations('receipts.extraction');
  const [progress, setProgress] = useState<ReceiptExtractionProgress | null>(null);
  const [thoughts, setThoughts] = useState('');
  const [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const thoughtsRef = useRef<HTMLDivElement | null>(null);

  useRealtimeEvents({ type: 'receipt.extraction.progress', receiptId }, (event) => {
    setProgress(event.progress);
    const thought = event.progress.thought;
    if (thought) {
      setThoughts((prev) => (prev + thought).slice(-THOUGHTS_MAX_CHARS));
    }
    // A real event preempts the rotation and restarts its clock.
    setTick(0);
  });

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), VERB_ROTATION_MS);
    return () => clearInterval(id);
    // New event → new interval, so the fresh line holds a full beat.
  }, [progress]);

  // Keep the expanded reasoning scrolled to the newest line.
  useEffect(() => {
    if (expanded && thoughtsRef.current) {
      thoughtsRef.current.scrollTop = thoughtsRef.current.scrollHeight;
    }
  }, [expanded, thoughts]);

  const stage = progress?.stage ?? null;
  let stageLine: string;
  if (stage === 'sending') {
    const model =
      progress?.provider && progress?.model
        ? (findLlmModel(progress.provider, progress.model)?.label ?? progress.model)
        : t('genericModel');
    stageLine = t('sendingTo', { model });
  } else if (stage === 'continuing') {
    stageLine = t('continuing', { pass: progress?.pass ?? 2 });
  } else if (stage === 'generating' && progress?.itemsSoFar !== undefined) {
    stageLine = t('itemsSoFar', { count: progress.itemsSoFar });
  } else {
    const rotating: RotatingStage = stage ?? 'waiting';
    stageLine = t(`verbs.${rotating}.${tick % VERBS_PER_STAGE}`);
  }

  const dot = (
    <span aria-hidden="true" className="relative flex h-2.5 w-2.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60 motion-reduce:hidden" />
      <span className="relative inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500 motion-reduce:animate-none dark:bg-blue-300" />
    </span>
  );

  if (variant === 'inline') {
    return (
      <span
        className="inline-flex min-w-0 max-w-48 items-center gap-1.5 text-xs text-blue-800 dark:text-blue-200"
        data-testid="extraction-activity-inline"
      >
        {dot}
        <span role="status" aria-live="polite" className="truncate">
          {stageLine}
        </span>
      </span>
    );
  }

  // Latest reasoning fragment as a one-line ticker; the disclosure holds the
  // full accumulation.
  const latestThought = progress?.thought ?? '';
  return (
    <div
      className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-900/20"
      data-testid="extraction-activity"
    >
      <div className="flex min-w-0 items-center gap-3">
        {dot}
        <div className="min-w-0 flex-1">
          <p
            role="status"
            aria-live="polite"
            className="text-sm font-medium text-blue-900 dark:text-blue-100"
            data-testid="extraction-stage-line"
          >
            {stageLine}
          </p>
          {latestThought && !expanded && (
            <p
              // Remount per fragment so the entrance transition replays.
              key={latestThought}
              className="mt-0.5 animate-pulse truncate text-xs text-blue-800/70 [animation-iteration-count:1] motion-reduce:animate-none dark:text-blue-200/70"
              data-testid="extraction-thought-ticker"
            >
              {latestThought}
            </p>
          )}
        </div>
      </div>
      {thoughts && (
        <div>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-primary-700 hover:underline dark:text-primary-300"
            data-testid="extraction-thoughts-toggle"
          >
            {expanded ? t('hideThoughts') : t('showThoughts')}
          </button>
          {expanded && (
            <div
              ref={thoughtsRef}
              className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-white/60 p-3 text-xs text-gray-600 dark:bg-gray-900/40 dark:text-gray-300"
              data-testid="extraction-thoughts-full"
            >
              {thoughts}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
