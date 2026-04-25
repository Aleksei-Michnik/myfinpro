import type { CategoryDirection } from '../types/payment.types';

/**
 * System-owned category slugs seeded on deploy.
 * The i18n display name is resolved on the frontend via a separate dictionary
 * (see apps/web/.../system-category-i18n.ts when added in a later iteration).
 * The `name` field fallback on the backend is the English label below.
 *
 * Note on slug collisions: there are two "Other" defaults (one per direction).
 * DB uniqueness is on (owner_type, owner_id, slug, direction), so `other` would
 * technically co-exist as (system, null, 'other', 'OUT') vs (system, null, 'other', 'IN').
 * For defensive clarity we use distinct slugs `other_out` / `other_in`.
 * Same for `gift` → `gift_in` (OUT stays as the plural `gifts`).
 */
export interface DefaultCategoryDef {
  slug: string;
  /** English display name (used as DB fallback; locales override on the frontend). */
  name: string;
  direction: CategoryDirection;
  /** Optional icon key (resolved by the UI); kept stable for theming. */
  icon?: string;
  /** Optional default color (hex). */
  color?: string;
}

export const DEFAULT_OUT_CATEGORIES: readonly DefaultCategoryDef[] = [
  { slug: 'groceries', name: 'Groceries', direction: 'OUT', icon: 'shopping-cart' },
  { slug: 'home', name: 'Home', direction: 'OUT', icon: 'home' },
  { slug: 'restaurants', name: 'Restaurants', direction: 'OUT', icon: 'utensils' },
  { slug: 'transport', name: 'Transport', direction: 'OUT', icon: 'car' },
  { slug: 'utilities', name: 'Utilities', direction: 'OUT', icon: 'bolt' },
  { slug: 'health', name: 'Health', direction: 'OUT', icon: 'heart-pulse' },
  { slug: 'entertainment', name: 'Entertainment', direction: 'OUT', icon: 'film' },
  { slug: 'clothing', name: 'Clothing', direction: 'OUT', icon: 'shirt' },
  { slug: 'travel', name: 'Travel', direction: 'OUT', icon: 'plane' },
  { slug: 'education', name: 'Education', direction: 'OUT', icon: 'book' },
  { slug: 'taxes', name: 'Taxes', direction: 'OUT', icon: 'file-text' },
  { slug: 'fees', name: 'Fees', direction: 'OUT', icon: 'receipt' },
  { slug: 'insurance', name: 'Insurance', direction: 'OUT', icon: 'shield' },
  { slug: 'gifts', name: 'Gifts', direction: 'OUT', icon: 'gift' },
  { slug: 'other_out', name: 'Other', direction: 'OUT', icon: 'more-horizontal' },
] as const;

export const DEFAULT_IN_CATEGORIES: readonly DefaultCategoryDef[] = [
  { slug: 'salary', name: 'Salary', direction: 'IN', icon: 'briefcase' },
  { slug: 'bonus', name: 'Bonus', direction: 'IN', icon: 'star' },
  { slug: 'freelance', name: 'Freelance', direction: 'IN', icon: 'laptop' },
  { slug: 'investment', name: 'Investment', direction: 'IN', icon: 'trending-up' },
  { slug: 'refund', name: 'Refund', direction: 'IN', icon: 'rotate-ccw' },
  { slug: 'gift_in', name: 'Gift', direction: 'IN', icon: 'gift' },
  { slug: 'other_in', name: 'Other', direction: 'IN', icon: 'more-horizontal' },
] as const;

/** Flat list of every system category seeded on deploy. */
export const DEFAULT_CATEGORIES: readonly DefaultCategoryDef[] = [
  ...DEFAULT_OUT_CATEGORIES,
  ...DEFAULT_IN_CATEGORIES,
] as const;
