// Compact form-control style for dense editing surfaces (receipt review
// header/cards, walkthrough search) — the larger <Input> component stays
// the default for standalone forms. Extracted in 8.24 so the item card
// and the review page share one definition.
export const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 ' +
  'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 ' +
  'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
