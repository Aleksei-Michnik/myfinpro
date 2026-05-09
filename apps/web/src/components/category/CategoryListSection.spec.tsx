import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategoryListSection } from './CategoryListSection';
import type { CategoryDto } from '@/lib/category/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, vals?: Record<string, string | number>) => {
    void vals;
    return k;
  },
}));

vi.mock('@/lib/category/category-context', () => ({
  useCategories: () => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn() }),
}));

function makeCat(p: Partial<CategoryDto> = {}): CategoryDto {
  return {
    id: p.id ?? 'c-1',
    slug: 'h',
    name: p.name ?? 'Hobby',
    icon: null,
    color: null,
    direction: 'OUT',
    ownerType: p.ownerType ?? 'user',
    ownerId: 'me',
    isSystem: p.isSystem ?? false,
    createdAt: '',
    updatedAt: '',
  };
}

describe('CategoryListSection', () => {
  it('renders system + custom rows', () => {
    render(
      <CategoryListSection
        title="Personal"
        scope={{ type: 'personal' }}
        systemCategories={[makeCat({ id: 's-1', ownerType: 'system', isSystem: true })]}
        customCategories={[makeCat({ id: 'c-1' })]}
      />,
    );
    expect(screen.getByTestId('category-row-s-1')).toBeInTheDocument();
    expect(screen.getByTestId('category-row-c-1')).toBeInTheDocument();
  });

  it('shows "+ New" button by default', () => {
    render(
      <CategoryListSection title="Personal" scope={{ type: 'personal' }} customCategories={[]} />,
    );
    expect(screen.getByTestId('category-section-personal-create')).toBeInTheDocument();
  });

  it('hides "+ New" button when readOnly', () => {
    render(
      <CategoryListSection
        title="Personal"
        scope={{ type: 'personal' }}
        customCategories={[]}
        readOnly
      />,
    );
    expect(screen.queryByTestId('category-section-personal-create')).not.toBeInTheDocument();
  });

  it('shows empty state when no rows', () => {
    render(
      <CategoryListSection title="Personal" scope={{ type: 'personal' }} customCategories={[]} />,
    );
    expect(screen.getByTestId('category-section-personal-empty')).toBeInTheDocument();
  });

  it('clicking "+ New" opens form dialog', () => {
    render(
      <CategoryListSection title="Personal" scope={{ type: 'personal' }} customCategories={[]} />,
    );
    fireEvent.click(screen.getByTestId('category-section-personal-create'));
    expect(screen.getByTestId('category-form-dialog')).toBeInTheDocument();
  });

  it('shows loading state when loading', () => {
    render(
      <CategoryListSection
        title="Personal"
        scope={{ type: 'personal' }}
        customCategories={[]}
        loading
      />,
    );
    expect(screen.getByTestId('category-section-personal-loading')).toBeInTheDocument();
  });
});
