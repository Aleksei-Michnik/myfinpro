/**
 * Common shared types used across all apps.
 */

import type { Locale } from '../constants';

/** Sort direction */
export type SortOrder = 'asc' | 'desc';

/** Consistent ID type across the application */
export type ID = string;

/** Standard timestamp fields for entities */
export interface Timestamps {
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last-update timestamp */
  updatedAt: string;
}

/** Locales that use right-to-left text direction */
export const RTL_LOCALES: Locale[] = ['he'];

/** Check whether a locale uses right-to-left text direction */
export function isRTL(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}
