import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategoryRow } from './CategoryRow';
import type { CategoryDto } from '@/lib/category/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, vals?: Record<string, string | number>) => {
    void vals;
    return k;
  },
}));

function makeCat(p: Partial<CategoryDto> = {}): CategoryDto {
  return {
    id: p.id ?? 'c-1',
    slug: 'misc',
    name: p.name ?? 'Misc',
    icon: p.icon ?? null,
    color: p.color ?? null,
    direction: p.direction ?? 'OUT',
    ownerType: p.ownerType ?? 'user',
    ownerId: 'me',
    isSystem: p.isSystem ?? false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('CategoryRow', () => {
  it('renders system category with Default badge and no actions', () => {
    render(<CategoryRow category={makeCat({ id: 's-1', ownerType: 'system', isSystem: true })} />);
    expect(screen.getByTestId('category-row-system-badge-s-1')).toBeInTheDocument();
    expect(screen.queryByTestId('category-row-actions-s-1')).not.toBeInTheDocument();
  });

  it('renders custom category without Default badge', () => {
    render(<CategoryRow category={makeCat({ id: 'c-2' })} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.queryByTestId('category-row-system-badge-c-2')).not.toBeInTheDocument();
  });

  it('renders name + direction + icon', () => {
    render(
      <CategoryRow
        category={makeCat({ id: 'c-3', name: 'Hobby', icon: '🎨', color: '#7c3aed' })}
      />,
    );
    expect(screen.getByTestId('category-row-name-c-3')).toHaveTextContent('Hobby');
    expect(screen.getByTestId('category-row-icon-c-3')).toHaveTextContent('🎨');
  });

  it('shows actions menu for custom rows when onEdit/onDelete provided', () => {
    render(<CategoryRow category={makeCat({ id: 'c-4' })} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.getByTestId('category-row-actions-c-4')).toBeInTheDocument();
  });

  it('clicking edit invokes onEdit with the category', () => {
    const onEdit = vi.fn();
    render(<CategoryRow category={makeCat({ id: 'c-5' })} onEdit={onEdit} />);
    fireEvent.click(screen.getByTestId('category-row-actions-c-5'));
    fireEvent.click(screen.getByTestId('category-row-edit-c-5'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-5' }));
  });
});
