'use client';

// Phase 6 · Iteration 6.16 — CategoryProvider.
// Mirrors the structure of [`payment-context.tsx`](apps/web/src/lib/payment/payment-context.tsx)
// — bearer-token auth via `useAuth().getAccessToken()`, per-method fetch,
// normalised `CategoryApiError` with `errorCode`. Maintains an in-memory
// cache of categories grouped by scope; mutations update the cache so
// downstream components (pickers, pages) re-render without a full reload.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type {
  CategoryApiError,
  CategoryDto,
  CreateCategoryInput,
  DeleteCategoryOptions,
  DeleteCategoryResult,
  UpdateCategoryInput,
} from './types';
import { useAuth } from '@/lib/auth/auth-context';

interface CategoryContextValue {
  /** All categories the user can see (system + personal + group memberships). */
  categories: CategoryDto[];
  isLoading: boolean;
  error: string | null;
  fetchAll(): Promise<CategoryDto[]>;
  /** System categories (read-only). */
  systemCategories(): CategoryDto[];
  /** Personal (user-owned) categories. */
  personalCategories(): CategoryDto[];
  /** Group-owned categories for a given group id. */
  groupCategories(groupId: string): CategoryDto[];
  findById(id: string): CategoryDto | undefined;
  create(input: CreateCategoryInput): Promise<CategoryDto>;
  update(id: string, input: UpdateCategoryInput): Promise<CategoryDto>;
  remove(id: string, opts?: DeleteCategoryOptions): Promise<DeleteCategoryResult>;
  clearError(): void;
}

const CategoryContext = createContext<CategoryContextValue | null>(null);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    errorCode?: string;
    details?: { usage?: number; sourceDir?: string; targetDir?: string };
  };
  const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  const err = new Error(msg || fallback) as CategoryApiError;
  if (body.errorCode) err.errorCode = body.errorCode;
  if (body.details) err.details = body.details;
  err.status = res.status;
  throw err;
}

function extractMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return 'Unexpected error';
}

export function CategoryProvider({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuth();
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback((): HeadersInit => {
    const token = getAccessToken();
    if (!token) throw new Error('Not authenticated');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }, [getAccessToken]);

  const fetchAll = useCallback(async (): Promise<CategoryDto[]> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/categories`, {
        method: 'GET',
        headers: authHeaders(),
      });
      if (!res.ok) await throwApiError(res, 'Failed to load categories');
      const data = (await res.json()) as CategoryDto[];
      setCategories(data);
      return data;
    } catch (e) {
      setError(extractMessage(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const create = useCallback(
    async (input: CreateCategoryInput): Promise<CategoryDto> => {
      setError(null);
      const res = await fetch(`${API_BASE}/categories`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(input),
      });
      if (!res.ok) await throwApiError(res, 'Failed to create category');
      const created = (await res.json()) as CategoryDto;
      setCategories((prev) => [...prev, created]);
      return created;
    },
    [authHeaders],
  );

  const update = useCallback(
    async (id: string, input: UpdateCategoryInput): Promise<CategoryDto> => {
      setError(null);
      const res = await fetch(`${API_BASE}/categories/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(input),
      });
      if (!res.ok) await throwApiError(res, 'Failed to update category');
      const updated = (await res.json()) as CategoryDto;
      setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
      return updated;
    },
    [authHeaders],
  );

  const remove = useCallback(
    async (id: string, opts?: DeleteCategoryOptions): Promise<DeleteCategoryResult> => {
      setError(null);
      const qs = opts?.replaceWithCategoryId
        ? `?replaceWithCategoryId=${encodeURIComponent(opts.replaceWithCategoryId)}`
        : '';
      const res = await fetch(`${API_BASE}/categories/${encodeURIComponent(id)}${qs}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) await throwApiError(res, 'Failed to delete category');
      const result = (await res.json()) as DeleteCategoryResult;
      setCategories((prev) => prev.filter((c) => c.id !== id));
      return result;
    },
    [authHeaders],
  );

  const clearError = useCallback(() => setError(null), []);

  const systemCategories = useCallback(
    () => categories.filter((c) => c.ownerType === 'system'),
    [categories],
  );
  const personalCategories = useCallback(
    () => categories.filter((c) => c.ownerType === 'user'),
    [categories],
  );
  const groupCategories = useCallback(
    (groupId: string) => categories.filter((c) => c.ownerType === 'group' && c.ownerId === groupId),
    [categories],
  );
  const findById = useCallback((id: string) => categories.find((c) => c.id === id), [categories]);

  const value = useMemo<CategoryContextValue>(
    () => ({
      categories,
      isLoading,
      error,
      fetchAll,
      systemCategories,
      personalCategories,
      groupCategories,
      findById,
      create,
      update,
      remove,
      clearError,
    }),
    [
      categories,
      isLoading,
      error,
      fetchAll,
      systemCategories,
      personalCategories,
      groupCategories,
      findById,
      create,
      update,
      remove,
      clearError,
    ],
  );

  return <CategoryContext.Provider value={value}>{children}</CategoryContext.Provider>;
}

export function useCategories(): CategoryContextValue {
  const ctx = useContext(CategoryContext);
  if (!ctx) {
    throw new Error('useCategories must be used within a CategoryProvider');
  }
  return ctx;
}
