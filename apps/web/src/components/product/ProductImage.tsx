'use client';

// Phase 8.27 — THE product <img> (docs/image-handling.md §4): lazy/async
// loading attributes and the shared cube placeholder, rendered when there
// is no picture or the rendition fails to load (e.g. still re-encoding).

import { useEffect, useState } from 'react';

export interface ProductImageProps {
  /** Rendition URL; null renders the placeholder outright. */
  src: string | null;
  alt?: string;
  /** Classes for the <img> (sizing/fit). */
  className?: string;
  /** Classes for the placeholder cube (sizing — the colour is fixed here). */
  placeholderClassName?: string;
  placeholderTestId?: string;
  imgTestId?: string;
}

export function ProductImage({
  src,
  alt = '',
  className,
  placeholderClassName,
  placeholderTestId = 'product-image-placeholder',
  imgTestId,
}: ProductImageProps) {
  const [failed, setFailed] = useState(false);
  // A new URL (re-upload bumps ?v=, renditions finish processing) deserves
  // a fresh attempt.
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <svg
        className={`${placeholderClassName ?? ''} text-gray-300 dark:text-gray-600`}
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
        data-testid={placeholderTestId}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
        />
      </svg>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
      data-testid={imgTestId}
    />
  );
}
