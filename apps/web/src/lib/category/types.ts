// Phase 6 · Iteration 6.16 — Category management types.
// Re-uses CategoryDto from payment types (shape returned by API).

export type { CategoryDto } from '@/lib/payment/types';

export interface CreateCategoryInput {
  name: string;
  scope: 'personal' | 'group';
  groupId?: string;
  direction: 'IN' | 'OUT' | 'BOTH';
  icon?: string;
  color?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  icon?: string;
  color?: string;
  direction?: 'IN' | 'OUT' | 'BOTH';
}

export interface DeleteCategoryOptions {
  /** UUID of replacement category if the original is in use. */
  replaceWithCategoryId?: string;
}

export interface DeleteCategoryResult {
  deleted: true;
  reassigned: number;
}

export interface CategoryApiError extends Error {
  errorCode?: string;
  status?: number;
  details?: { usage?: number; sourceDir?: string; targetDir?: string };
}
