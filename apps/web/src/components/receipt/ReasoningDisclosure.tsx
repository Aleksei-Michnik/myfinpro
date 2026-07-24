'use client';

// Model-reasoning disclosure — one toggle + formatted-text box, shared by the
// live extraction panel (streaming buffer, `follow` keeps the newest line in
// view) and the review page's persisted transcript (`Receipt.extractionReasoning`).

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

export function ReasoningDisclosure({
  text,
  follow = false,
  maxHeightClass = 'max-h-48',
  testIdPrefix,
  onExpandedChange,
}: {
  text: string;
  /** Keep the box scrolled to the newest line as `text` grows (live stream). */
  follow?: boolean;
  maxHeightClass?: string;
  testIdPrefix: string;
  /** Lets the host hide adjacent UI (e.g. the live ticker) while open. */
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const t = useTranslations('receipts.extraction');
  const [expanded, setExpanded] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (follow && expanded && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [follow, expanded, text]);

  if (!text) return null;
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          onExpandedChange?.(next);
        }}
        className="text-xs text-primary-700 hover:underline dark:text-primary-300"
        data-testid={`${testIdPrefix}-toggle`}
      >
        {expanded ? t('hideThoughts') : t('showThoughts')}
      </button>
      {expanded && (
        <div
          ref={boxRef}
          className={`mt-2 ${maxHeightClass} overflow-y-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-white/60 p-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300`}
          data-testid={`${testIdPrefix}-full`}
        >
          {text}
        </div>
      )}
    </div>
  );
}
