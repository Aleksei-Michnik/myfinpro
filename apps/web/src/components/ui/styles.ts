// Phase 20 · Iteration 20.1 — shared class fragments of the UI kit. Extracted
// so a token lives once: before this the focus ring was copy-pasted in
// `layout/Header.tsx` and `layout/Sidebar.tsx`.

/** Shared focus ring for keyboard navigation visibility. */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600';

/** Surface of a raised block (card, dialog panel) in both colour schemes. */
export const surfaceClass = 'bg-white dark:bg-gray-800';

/** Hairline border of a raised block in both colour schemes. */
export const borderClass = 'border border-gray-200 dark:border-gray-700';

/** Joins class fragments, dropping the falsy ones. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
