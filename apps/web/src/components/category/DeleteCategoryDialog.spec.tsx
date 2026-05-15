import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';
import type { CategoryDto } from '@/lib/category/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, vals?: Record<string, string | number>) => {
    if (vals) return `${k}:${JSON.stringify(vals)}`;
    return k;
  },
}));

const mockRemove = vi.fn();
vi.mock('@/lib/category/category-context', () => ({
  useCategories: () => ({ remove: mockRemove }),
}));

function makeCat(p: Partial<CategoryDto> = {}): CategoryDto {
  return {
    id: p.id ?? 'c-1',
    slug: 'h',
    name: p.name ?? 'Hobby',
    icon: null,
    color: null,
    direction: p.direction ?? 'OUT',
    ownerType: 'user',
    ownerId: 'me',
    isSystem: false,
    createdAt: '',
    updatedAt: '',
  };
}

describe('DeleteCategoryDialog', () => {
  beforeEach(() => {
    mockRemove.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the warning message', () => {
    render(
      <DeleteCategoryDialog
        category={makeCat()}
        candidates={[]}
        open
        onClose={() => {}}
        onDeleted={() => {}}
      />,
    );
    expect(screen.getByTestId('delete-category-dialog')).toBeInTheDocument();
  });

  it('clicking confirm with no usage calls remove() and onDeleted', async () => {
    mockRemove.mockResolvedValueOnce({ deleted: true, reassigned: 0 });
    const onDeleted = vi.fn();
    render(
      <DeleteCategoryDialog
        category={makeCat()}
        candidates={[]}
        open
        onClose={() => {}}
        onDeleted={onDeleted}
      />,
    );
    fireEvent.click(screen.getByTestId('delete-category-confirm'));
    await waitFor(() =>
      expect(mockRemove).toHaveBeenCalledWith('c-1', {}, expect.any(AbortSignal)),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('CATEGORY_IN_USE error shows replacement select with usage count', async () => {
    mockRemove.mockRejectedValueOnce(
      Object.assign(new Error('In use'), {
        errorCode: 'CATEGORY_IN_USE',
        details: { usage: 3 },
      }),
    );
    render(
      <DeleteCategoryDialog
        category={makeCat()}
        candidates={[makeCat({ id: 'c-2', name: 'Other' })]}
        open
        onClose={() => {}}
        onDeleted={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('delete-category-confirm'));
    await waitFor(() => expect(screen.getByTestId('delete-category-in-use')).toBeInTheDocument());
    expect(screen.getByTestId('delete-category-replace-select')).toBeInTheDocument();
  });

  it('cancel calls onClose', () => {
    const onClose = vi.fn();
    render(
      <DeleteCategoryDialog
        category={makeCat()}
        candidates={[]}
        open
        onClose={onClose}
        onDeleted={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('delete-category-cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
