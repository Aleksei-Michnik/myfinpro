import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CategoriesSettingsPage from './page';
import type { CategoryDto } from '@/lib/category/types';

const mockFetchAll = vi.fn();

let categoriesData: CategoryDto[] = [];

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, vals?: Record<string, string | number>) => {
    if (vals?.group) return `${vals.group}`;
    return k;
  },
}));

vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/category/category-context', () => ({
  useCategories: () => ({
    fetchAll: mockFetchAll,
    isLoading: false,
    systemCategories: () => categoriesData.filter((c) => c.ownerType === 'system'),
    personalCategories: () => categoriesData.filter((c) => c.ownerType === 'user'),
    groupCategories: (gid: string) =>
      categoriesData.filter((c) => c.ownerType === 'group' && c.ownerId === gid),
  }),
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({
    groups: [
      {
        id: 'g-1',
        name: 'Family',
        type: 'family',
        defaultCurrency: 'USD',
        createdById: 'me',
        createdAt: '',
        updatedAt: '',
        memberCount: 2,
      },
    ],
  }),
}));

function makeCat(p: Partial<CategoryDto> = {}): CategoryDto {
  return {
    id: p.id ?? 'c-1',
    slug: 'h',
    name: p.name ?? 'Cat',
    icon: null,
    color: null,
    direction: 'OUT',
    ownerType: p.ownerType ?? 'user',
    ownerId: p.ownerId ?? 'me',
    isSystem: p.isSystem ?? false,
    createdAt: '',
    updatedAt: '',
  };
}

describe('CategoriesSettingsPage', () => {
  beforeEach(() => {
    mockFetchAll.mockReset();
    mockFetchAll.mockResolvedValue([]);
    categoriesData = [];
  });

  it('renders the page heading', () => {
    render(<CategoriesSettingsPage />);
    expect(screen.getByTestId('categories-page')).toBeInTheDocument();
  });

  it('calls fetchAll on mount', async () => {
    render(<CategoriesSettingsPage />);
    await waitFor(() => expect(mockFetchAll).toHaveBeenCalled());
  });

  it('renders Personal section', () => {
    render(<CategoriesSettingsPage />);
    expect(screen.getByTestId('category-section-personal')).toBeInTheDocument();
  });

  it('renders one section per group', () => {
    render(<CategoriesSettingsPage />);
    expect(screen.getByTestId('category-section-g-1')).toBeInTheDocument();
  });

  it('renders system + custom categories in Personal section', () => {
    categoriesData = [
      makeCat({ id: 's-1', ownerType: 'system', isSystem: true, name: 'Food' }),
      makeCat({ id: 'p-1', ownerType: 'user', name: 'Hobby' }),
    ];
    render(<CategoriesSettingsPage />);
    expect(screen.getByTestId('category-row-s-1')).toBeInTheDocument();
    expect(screen.getByTestId('category-row-p-1')).toBeInTheDocument();
  });
});
