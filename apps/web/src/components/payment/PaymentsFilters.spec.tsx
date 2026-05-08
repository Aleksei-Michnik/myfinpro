import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentsFilters, type PaymentsFiltersValue } from './PaymentsFilters';
import type { CategoryDto } from '@/lib/payment/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockListCategories = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === 'scopeGroup' && values?.name !== undefined) {
      return String(values.name);
    }
    return key;
  },
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({
    groups: [
      {
        id: 'g-1',
        name: 'Family',
        type: 'family',
        defaultCurrency: 'USD',
        createdById: 'u-1',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        memberCount: 2,
      },
      {
        id: 'g-2',
        name: 'Work',
        type: 'family',
        defaultCurrency: 'USD',
        createdById: 'u-1',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        memberCount: 4,
      },
    ],
  }),
}));

vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({
    listCategories: mockListCategories,
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function defaultValue(): PaymentsFiltersValue {
  return { sort: 'date_desc' };
}

function makeCategory(p: Partial<CategoryDto>): CategoryDto {
  return {
    id: p.id ?? 'c-1',
    slug: p.slug ?? 'misc',
    name: p.name ?? 'Misc',
    icon: null,
    color: null,
    direction: p.direction ?? 'BOTH',
    ownerType: p.ownerType ?? 'system',
    ownerId: p.ownerId ?? null,
    isSystem: p.ownerType === 'system' || p.isSystem === true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('PaymentsFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCategories.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders every control by default', () => {
    render(<PaymentsFilters value={defaultValue()} onChange={vi.fn()} categories={[]} />);
    expect(screen.getByTestId('filter-direction-all')).toBeInTheDocument();
    expect(screen.getByTestId('filter-direction-in')).toBeInTheDocument();
    expect(screen.getByTestId('filter-direction-out')).toBeInTheDocument();
    expect(screen.getByTestId('filter-scope')).toBeInTheDocument();
    expect(screen.getByTestId('filter-starred')).toBeInTheDocument();
    expect(screen.getByTestId('filter-search')).toBeInTheDocument();
    expect(screen.getByTestId('filter-from')).toBeInTheDocument();
    expect(screen.getByTestId('filter-to')).toBeInTheDocument();
    expect(screen.getByTestId('filter-category')).toBeInTheDocument();
    expect(screen.getByTestId('filter-sort')).toBeInTheDocument();
  });

  it('clicking IN sets direction to "IN"; clicking All clears it', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PaymentsFilters value={defaultValue()} onChange={onChange} categories={[]} />,
    );
    fireEvent.click(screen.getByTestId('filter-direction-in'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'IN' }));

    rerender(
      <PaymentsFilters
        value={{ ...defaultValue(), direction: 'IN' }}
        onChange={onChange}
        categories={[]}
      />,
    );
    fireEvent.click(screen.getByTestId('filter-direction-all'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ direction: undefined }));
  });

  it('OUT button sets direction to "OUT"', () => {
    const onChange = vi.fn();
    render(<PaymentsFilters value={defaultValue()} onChange={onChange} categories={[]} />);
    fireEvent.click(screen.getByTestId('filter-direction-out'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ direction: 'OUT' }));
  });

  it('starred checkbox flips the boolean', () => {
    const onChange = vi.fn();
    render(<PaymentsFilters value={defaultValue()} onChange={onChange} categories={[]} />);
    const cb = screen.getByTestId('filter-starred') as HTMLInputElement;
    fireEvent.click(cb);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ starred: true }));
  });

  it('search debounce: emits onChange exactly once after 300 ms', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<PaymentsFilters value={defaultValue()} onChange={onChange} categories={[]} />);
    const input = screen.getByTestId('filter-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'f' } });
    fireEvent.change(input, { target: { value: 'fo' } });
    fireEvent.change(input, { target: { value: 'foo' } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'foo' }));
  });

  it('sort change triggers onChange with the new sort key', () => {
    const onChange = vi.fn();
    render(<PaymentsFilters value={defaultValue()} onChange={onChange} categories={[]} />);
    fireEvent.change(screen.getByTestId('filter-sort'), {
      target: { value: 'amount_desc' },
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'amount_desc' }));
  });

  it('date inputs emit onChange', () => {
    const onChange = vi.fn();
    render(<PaymentsFilters value={defaultValue()} onChange={onChange} categories={[]} />);
    fireEvent.change(screen.getByTestId('filter-from'), {
      target: { value: '2026-01-01' },
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-01-01' }));
    fireEvent.change(screen.getByTestId('filter-to'), {
      target: { value: '2026-12-31' },
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ to: '2026-12-31' }));
  });

  it('hide.scope=true hides the scope dropdown', () => {
    render(
      <PaymentsFilters
        value={defaultValue()}
        onChange={vi.fn()}
        hide={{ scope: true }}
        categories={[]}
      />,
    );
    expect(screen.queryByTestId('filter-scope')).not.toBeInTheDocument();
  });

  it('scope dropdown lists All / Personal / per-group entries', () => {
    render(<PaymentsFilters value={defaultValue()} onChange={vi.fn()} categories={[]} />);
    const select = screen.getByTestId('filter-scope') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['all', 'personal', 'group:g-1', 'group:g-2']);
  });

  it('category prop: dropdown lists provided categories grouped + "Any category"', () => {
    const cats: CategoryDto[] = [
      makeCategory({ id: 's-1', name: 'Salary', ownerType: 'system' }),
      makeCategory({
        id: 'u-1',
        name: 'Hobbies',
        ownerType: 'user',
        ownerId: 'me',
      }),
      makeCategory({
        id: 'g-1',
        name: 'Groceries',
        ownerType: 'group',
        ownerId: 'g-1',
      }),
    ];
    render(<PaymentsFilters value={defaultValue()} onChange={vi.fn()} categories={cats} />);
    const select = screen.getByTestId('filter-category') as HTMLSelectElement;
    expect(select.options[0].value).toBe('');
    const ids = Array.from(select.options).map((o) => o.value);
    expect(ids).toEqual(['', 's-1', 'u-1', 'g-1']);
  });

  it('fetches categories on mount when prop is undefined', async () => {
    mockListCategories.mockResolvedValueOnce([
      makeCategory({ id: 's-1', name: 'Salary', ownerType: 'system' }),
    ]);
    render(<PaymentsFilters value={defaultValue()} onChange={vi.fn()} />);
    await waitFor(() => {
      expect(mockListCategories).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      const select = screen.getByTestId('filter-category') as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.value)).toContain('s-1');
    });
  });

  it('refetches categories when direction changes', async () => {
    mockListCategories.mockResolvedValue([]);
    const { rerender } = render(<PaymentsFilters value={defaultValue()} onChange={vi.fn()} />);
    await waitFor(() => expect(mockListCategories).toHaveBeenCalledTimes(1));
    expect(mockListCategories).toHaveBeenLastCalledWith(undefined);
    rerender(
      <PaymentsFilters value={{ ...defaultValue(), direction: 'OUT' }} onChange={vi.fn()} />,
    );
    await waitFor(() => expect(mockListCategories).toHaveBeenCalledTimes(2));
    expect(mockListCategories).toHaveBeenLastCalledWith({ direction: 'OUT' });
  });

  it('does not impose any inline LTR/RTL style (RTL smoke test)', () => {
    const { container } = render(
      <PaymentsFilters value={defaultValue()} onChange={vi.fn()} categories={[]} />,
    );
    const root = container.querySelector('[data-testid="payments-filters"]') as HTMLElement;
    expect(root.style.direction).toBe('');
  });
});
