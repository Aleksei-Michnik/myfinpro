import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryFormDialog } from './CategoryFormDialog';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, vals?: Record<string, string | number>) => {
    if (vals && vals.message !== undefined) return `${k}:${vals.message}`;
    return k;
  },
}));

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
vi.mock('@/lib/category/category-context', () => ({
  useCategories: () => ({ create: mockCreate, update: mockUpdate }),
}));

describe('CategoryFormDialog', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockUpdate.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('does not render when open=false', () => {
    render(
      <CategoryFormDialog
        mode="create"
        scope={{ type: 'personal' }}
        open={false}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.queryByTestId('category-form-dialog')).not.toBeInTheDocument();
  });

  it('renders create dialog when open=true', () => {
    render(
      <CategoryFormDialog
        mode="create"
        scope={{ type: 'personal' }}
        open
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId('category-form-dialog')).toBeInTheDocument();
  });

  it('shows name validation error when empty', async () => {
    render(
      <CategoryFormDialog
        mode="create"
        scope={{ type: 'personal' }}
        open
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('category-form-submit'));
    await waitFor(() => expect(screen.getByTestId('category-form-name-error')).toBeInTheDocument());
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('shows color validation error when invalid hex', async () => {
    render(
      <CategoryFormDialog
        mode="create"
        scope={{ type: 'personal' }}
        open
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId('category-form-name'), { target: { value: 'X' } });
    fireEvent.change(screen.getByTestId('category-form-color'), { target: { value: 'badcol' } });
    fireEvent.click(screen.getByTestId('category-form-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('category-form-color-error')).toBeInTheDocument(),
    );
  });

  it('preset chip click sets the color value', () => {
    render(
      <CategoryFormDialog
        mode="create"
        scope={{ type: 'personal' }}
        open
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('category-form-preset-#10b981'));
    expect((screen.getByTestId('category-form-color') as HTMLInputElement).value).toBe('#10b981');
  });

  it('create scope=personal posts the right payload', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'new',
      slug: 'h',
      name: 'Hobby',
      icon: '🎨',
      color: '#7c3aed',
      direction: 'OUT',
      ownerType: 'user',
      ownerId: 'me',
      isSystem: false,
      createdAt: '',
      updatedAt: '',
    });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <CategoryFormDialog
        mode="create"
        scope={{ type: 'personal' }}
        open
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByTestId('category-form-name'), { target: { value: 'Hobby' } });
    fireEvent.change(screen.getByTestId('category-form-icon'), { target: { value: '🎨' } });
    fireEvent.change(screen.getByTestId('category-form-color'), { target: { value: '#7c3aed' } });
    fireEvent.click(screen.getByTestId('category-form-direction-OUT'));
    fireEvent.click(screen.getByTestId('category-form-submit'));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        {
          name: 'Hobby',
          scope: 'personal',
          groupId: undefined,
          direction: 'OUT',
          icon: '🎨',
          color: '#7c3aed',
        },
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('edit mode pre-fills fields and PATCHes', async () => {
    mockUpdate.mockResolvedValueOnce({
      id: 'c-1',
      slug: 'h',
      name: 'Hobbies',
      icon: '🎨',
      color: '#7c3aed',
      direction: 'OUT',
      ownerType: 'user',
      ownerId: 'me',
      isSystem: false,
      createdAt: '',
      updatedAt: '',
    });
    render(
      <CategoryFormDialog
        mode="edit"
        scope={{ type: 'personal' }}
        category={{
          id: 'c-1',
          slug: 'h',
          name: 'Hobby',
          icon: '🎨',
          color: '#7c3aed',
          direction: 'OUT',
          ownerType: 'user',
          ownerId: 'me',
          isSystem: false,
          createdAt: '',
          updatedAt: '',
        }}
        open
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect((screen.getByTestId('category-form-name') as HTMLInputElement).value).toBe('Hobby');
    fireEvent.change(screen.getByTestId('category-form-name'), {
      target: { value: 'Hobbies' },
    });
    fireEvent.click(screen.getByTestId('category-form-submit'));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        'c-1',
        expect.objectContaining({ name: 'Hobbies' }),
        expect.any(AbortSignal),
      ),
    );
  });

  it('maps CATEGORY_SLUG_CONFLICT to a duplicate-name error', async () => {
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error('dupe'), { errorCode: 'CATEGORY_SLUG_CONFLICT' }),
    );
    render(
      <CategoryFormDialog
        mode="create"
        scope={{ type: 'personal' }}
        open
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId('category-form-name'), { target: { value: 'X' } });
    fireEvent.click(screen.getByTestId('category-form-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('category-form-name-error')).toHaveTextContent('errors.duplicate'),
    );
  });

  it('cancel button calls onClose', () => {
    const onClose = vi.fn();
    render(
      <CategoryFormDialog
        mode="create"
        scope={{ type: 'personal' }}
        open
        onClose={onClose}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('category-form-cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
