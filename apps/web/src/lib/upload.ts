// Phase 8.27 — THE client-side intake gate (docs/image-handling.md §4):
// the accept lists and pre-upload validation shared by every upload surface.
// The server re-validates authoritatively (magic-byte sniff, size caps);
// this layer only saves the user a doomed round-trip.

/** Image formats the server pipelines accept (product pictures, receipt photos). */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic';

/** Receipt intake additionally takes PDF slips. */
export const RECEIPT_ACCEPT = `${IMAGE_ACCEPT},application/pdf`;

export interface UploadRejection {
  file: File;
  reason: 'type' | 'size';
}

export interface UploadValidationResult {
  accepted: File[];
  rejected: UploadRejection[];
}

/**
 * Split picked/dropped files into uploadable and rejected-with-reason.
 * `accept` is a comma-separated MIME list (`image/*`-style wildcards
 * supported); files with an empty `type` (some OS/browser combos report
 * none, e.g. dragged HEIC) pass through — the server sniff decides.
 */
export function validateUploadFiles(
  files: File[],
  opts: { accept: string; maxBytes: number },
): UploadValidationResult {
  const allowed = opts.accept
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const typeAllowed = (file: File): boolean => {
    const type = file.type.toLowerCase();
    if (!type) return true;
    return allowed.some((entry) =>
      entry.endsWith('/*') ? type.startsWith(entry.slice(0, -1)) : type === entry,
    );
  };

  const accepted: File[] = [];
  const rejected: UploadRejection[] = [];
  for (const file of files) {
    if (!typeAllowed(file)) rejected.push({ file, reason: 'type' });
    else if (file.size > opts.maxBytes) rejected.push({ file, reason: 'size' });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

/** `common.upload` translator shape (kept structural — no next-intl import). */
type UploadTranslator = (key: string, values?: Record<string, string | number>) => string;

/** One rejection → its `common.upload` toast message. */
export function uploadRejectionMessage(
  t: UploadTranslator,
  { file, reason }: UploadRejection,
  maxBytes: number,
): string {
  return reason === 'size'
    ? t('rejectedSize', { name: file.name, maxMb: Math.round(maxBytes / (1024 * 1024)) })
    : t('rejectedType', { name: file.name });
}
