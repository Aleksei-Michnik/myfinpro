import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentCategoryPicker } from './PaymentCategoryPicker';
import type { CategoryDto } from '@/lib/payment/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (values?.name) return `${key}:${values.name}`;
    if (values?.message) return `${key}:${values.message}`;
    return key;
  },
}));

const listCategoriesMock = vi.fn();

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({ groups: [{ id: 'g1', name: 'Family' }] }),
}));

vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({ listCategories: listCategoriesMock }),
}));

function cat(partial: Partial<CategoryDto>): CategoryDto {
  return {
    id: partial.id ?? 'c',
    slug: partial.slug ?? 'slug',
    name: partial.name ?? 'Name',
    icon: partial.icon ?? null,
    color: null,
    direction: partial.direction ?? 'BOTH',
    ownerType: partial.ownerType ?? 'system',
    ownerId: partial.ownerId ?? null,
    isSystem: partial.ownerType === 'system',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

describe('PaymentCategoryPicker', () => {
  beforeEach(() => {
    listCategoriesMock.mockReset();
  });

  it('fetches on mount when categories prop is undefined', async () => {
    listCategoriesMock.mockResolvedValueOnce([]);
    render(<PaymentCategoryPicker direction="OUT" value={null} onChange={() => {}} />);
    await waitFor(() =>
      expect(listCategoriesMock).toHaveBeenCalledWith(
        { direction: 'OUT' },
        expect.any(AbortSignal),
      ),
    );
  });

  it('refetches when direction changes', async () => {
    listCategoriesMock.mockResolvedValue([]);
    const { rerender } = render(
      <PaymentCategoryPicker direction="OUT" value={null} onChange={() => {}} />,
    );
    await waitFor(() => expect(listCategoriesMock).toHaveBeenCalledTimes(1));
    rerender(<PaymentCategoryPicker direction="IN" value={null} onChange={() => {}} />);
    await waitFor(() => expect(listCategoriesMock).toHaveBeenCalledTimes(2));
    expect((listCategoriesMock.mock.calls[1][0] as { direction: string }).direction).toBe('IN');
  });

  it('does not fetch when categories prop is provided', async () => {
    render(
      <PaymentCategoryPicker
        direction="OUT"
        value={null}
        onChange={() => {}}
        categories={[cat({ id: 'c1', name: 'Groceries', ownerType: 'system', direction: 'OUT' })]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('category-picker-select')).toBeInTheDocument());
    expect(listCategoriesMock).not.toHaveBeenCalled();
  });

  it('renders System / Personal / Group optgroups', async () => {
    const cats = [
      cat({ id: 's1', name: 'Food', ownerType: 'system', direction: 'OUT' }),
      cat({ id: 'u1', name: 'Subs', ownerType: 'user', direction: 'OUT' }),
      cat({ id: 'g1c', name: 'Rent', ownerType: 'group', ownerId: 'g1', direction: 'OUT' }),
    ];
    render(
      <PaymentCategoryPicker direction="OUT" value={null} onChange={() => {}} categories={cats} />,
    );
    const select = screen.getByTestId('category-picker-select');
    expect(select.querySelector('optgroup[label="groupSystem"]')).toBeTruthy();
    expect(select.querySelector('optgroup[label="groupPersonal"]')).toBeTruthy();
    expect(select.querySelector('optgroup[label="groupGroup:Family"]')).toBeTruthy();
  });

  it('filters out non-matching directions but keeps BOTH', () => {
    const cats = [
      cat({ id: 'c1', name: 'OutOnly', ownerType: 'system', direction: 'OUT' }),
      cat({ id: 'c2', name: 'InOnly', ownerType: 'system', direction: 'IN' }),
      cat({ id: 'c3', name: 'Both', ownerType: 'system', direction: 'BOTH' }),
    ];
    render(
      <PaymentCategoryPicker direction="OUT" value={null} onChange={() => {}} categories={cats} />,
    );
    const select = screen.getByTestId('category-picker-select');
    const values = Array.from(select.querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(values).toContain('c1');
    expect(values).toContain('c3');
    expect(values).not.toContain('c2');
  });

  it('shows BOTH badge next to BOTH-direction categories', () => {
    const cats = [cat({ id: 'c3', name: 'Both', ownerType: 'system', direction: 'BOTH' })];
    render(
      <PaymentCategoryPicker direction="OUT" value={null} onChange={() => {}} categories={cats} />,
    );
    expect(screen.getByRole('option', { name: /bothBadge/ })).toBeInTheDocument();
  });

  it('emits onChange when a category is selected', () => {
    const onChange = vi.fn();
    const cats = [cat({ id: 'c1', name: 'X', ownerType: 'system', direction: 'OUT' })];
    render(
      <PaymentCategoryPicker direction="OUT" value={null} onChange={onChange} categories={cats} />,
    );
    fireEvent.change(screen.getByTestId('category-picker-select'), { target: { value: 'c1' } });
    expect(onChange).toHaveBeenCalledWith('c1');
  });

  it('shows loading state while fetching', async () => {
    let resolveFn!: (v: CategoryDto[]) => void;
    listCategoriesMock.mockReturnValueOnce(
      new Promise<CategoryDto[]>((resolve) => {
        resolveFn = resolve;
      }),
    );
    render(<PaymentCategoryPicker direction="OUT" value={null} onChange={() => {}} />);
    expect(screen.getByTestId('category-picker-select')).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      resolveFn!([]);
    });
  });

  it('shows error banner when fetch fails', async () => {
    listCategoriesMock.mockRejectedValueOnce(new Error('Boom'));
    render(<PaymentCategoryPicker direction="OUT" value={null} onChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId('category-picker-error')).toHaveTextContent('Boom'),
    );
  });

  it('disabled=true disables the select', () => {
    const cats = [cat({ id: 'c1', name: 'X', ownerType: 'system', direction: 'OUT' })];
    render(
      <PaymentCategoryPicker
        direction="OUT"
        value={null}
        onChange={() => {}}
        categories={cats}
        disabled
      />,
    );
    expect((screen.getByTestId('category-picker-select') as HTMLSelectElement).disabled).toBe(true);
  });

  it('renders placeholder option when no value', () => {
    render(
      <PaymentCategoryPicker direction="OUT" value={null} onChange={() => {}} categories={[]} />,
    );
    expect(screen.getByRole('option', { name: 'placeholder' })).toBeInTheDocument();
  });
});
