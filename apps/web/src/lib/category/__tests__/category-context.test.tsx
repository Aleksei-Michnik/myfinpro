import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryProvider, useCategories } from '../category-context';
import type { CategoryDto } from '../types';

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ getAccessToken: () => 'test-token' }),
}));

const API = '/api/v1';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeCat(p: Partial<CategoryDto> = {}): CategoryDto {
  return {
    id: p.id ?? 'c-1',
    slug: p.slug ?? 'misc',
    name: p.name ?? 'Misc',
    icon: p.icon ?? null,
    color: p.color ?? null,
    direction: p.direction ?? 'BOTH',
    ownerType: p.ownerType ?? 'user',
    ownerId: p.ownerId ?? 'u-me',
    isSystem: p.isSystem ?? false,
    createdAt: p.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: p.updatedAt ?? '2026-01-01T00:00:00Z',
  };
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <CategoryProvider>{children}</CategoryProvider>
);

describe('useCategories', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useCategories())).toThrow(/CategoryProvider/);
    spy.mockRestore();
  });

  it('fetchAll() loads + groups categories by ownerType', async () => {
    const list: CategoryDto[] = [
      makeCat({ id: 's-1', ownerType: 'system', isSystem: true, name: 'Food' }),
      makeCat({ id: 'p-1', ownerType: 'user', name: 'Hobby' }),
      makeCat({ id: 'g-1', ownerType: 'group', ownerId: 'grp-1', name: 'Outings' }),
    ];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(200, list));
    const { result } = renderHook(() => useCategories(), { wrapper });
    await act(async () => {
      await result.current.fetchAll();
    });
    expect(result.current.categories).toHaveLength(3);
    expect(result.current.systemCategories()).toHaveLength(1);
    expect(result.current.personalCategories()).toHaveLength(1);
    expect(result.current.groupCategories('grp-1')).toHaveLength(1);
    expect(result.current.findById('p-1')?.name).toBe('Hobby');
  });

  it('create() POSTs and appends to cache', async () => {
    const created = makeCat({ id: 'new', name: 'New' });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(201, created),
    );
    const { result } = renderHook(() => useCategories(), { wrapper });
    let returned!: CategoryDto;
    await act(async () => {
      returned = await result.current.create({
        name: 'New',
        scope: 'personal',
        direction: 'OUT',
      });
    });
    expect(returned.id).toBe('new');
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(`${API}/categories`);
    expect(call[1].method).toBe('POST');
    await waitFor(() => expect(result.current.categories).toHaveLength(1));
  });

  it('update() PATCHes and updates cache', async () => {
    const initial: CategoryDto[] = [makeCat({ id: 'p-1', name: 'Old' })];
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse(200, initial))
      .mockResolvedValueOnce(jsonResponse(200, makeCat({ id: 'p-1', name: 'New' })));
    const { result } = renderHook(() => useCategories(), { wrapper });
    await act(async () => {
      await result.current.fetchAll();
    });
    await act(async () => {
      await result.current.update('p-1', { name: 'New' });
    });
    expect(result.current.findById('p-1')?.name).toBe('New');
  });

  it('remove() DELETEs and removes from cache', async () => {
    const initial: CategoryDto[] = [makeCat({ id: 'p-1' })];
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse(200, initial))
      .mockResolvedValueOnce(jsonResponse(200, { deleted: true, reassigned: 0 }));
    const { result } = renderHook(() => useCategories(), { wrapper });
    await act(async () => {
      await result.current.fetchAll();
    });
    await act(async () => {
      await result.current.remove('p-1');
    });
    expect(result.current.findById('p-1')).toBeUndefined();
  });

  it('remove() with replaceWithCategoryId appends query string', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, { deleted: true, reassigned: 4 }),
    );
    const { result } = renderHook(() => useCategories(), { wrapper });
    await act(async () => {
      await result.current.remove('p-1', { replaceWithCategoryId: 'p-2' });
    });
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(call).toContain('replaceWithCategoryId=p-2');
  });

  it('error includes errorCode + status from API body', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(409, {
        message: 'In use',
        errorCode: 'CATEGORY_IN_USE',
        details: { usage: 3 },
      }),
    );
    const { result } = renderHook(() => useCategories(), { wrapper });
    await expect(result.current.remove('p-1')).rejects.toMatchObject({
      message: 'In use',
      errorCode: 'CATEGORY_IN_USE',
      status: 409,
      details: { usage: 3 },
    });
  });

  it('fetchAll() error sets error state and rethrows', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(500, { message: 'boom' }),
    );
    const { result } = renderHook(() => useCategories(), { wrapper });
    await expect(result.current.fetchAll()).rejects.toThrow('boom');
    await waitFor(() => expect(result.current.error).toBe('boom'));
  });

  it('clearError() resets error', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(500, { message: 'boom' }),
    );
    const { result } = renderHook(() => useCategories(), { wrapper });
    await expect(result.current.fetchAll()).rejects.toBeInstanceOf(Error);
    act(() => result.current.clearError());
    await waitFor(() => expect(result.current.error).toBeNull());
  });
});
