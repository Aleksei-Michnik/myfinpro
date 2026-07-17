import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetFormDialog } from './BudgetFormDialog';
import type { BudgetSummary } from '@/lib/budget/types';
import type { CategoryDto } from '@/lib/transaction/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (values && typeof values.message === 'string') return `${key}:${values.message}`;
    if (values && typeof values.name === 'string') return `${key}:${values.name}`;
    return key;
  },
}));

const createBudgetMock = vi.fn();
const updateBudgetMock = vi.fn();
const listCategoriesMock = vi.fn();

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', defaultCurrency: 'USD' } }),
}));

// The group's defaultCurrency differs from the user's so the
// currency-follows-scope behaviour is observable.
vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({
    groups: [{ id: 'g1', name: 'Family', role: 'admin', defaultCurrency: 'ILS' }],
  }),
}));

vi.mock('@/lib/budget/budget-context', () => ({
  useBudgets: () => ({
    createBudget: createBudgetMock,
    updateBudget: updateBudgetMock,
  }),
}));

vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({
    listCategories: listCategoriesMock,
  }),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

function cat(partial: Partial<CategoryDto>): CategoryDto {
  return {
    id: partial.id ?? 'c',
    slug: 'slug',
    name: partial.name ?? 'Name',
    icon: null,
    color: null,
    direction: partial.direction ?? 'OUT',
    ownerType: partial.ownerType ?? 'system',
    ownerId: partial.ownerId ?? null,
    isSystem: partial.ownerType === 'system',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

const DEFAULT_CATS: CategoryDto[] = [
  cat({ id: 'c-out', name: 'Food', ownerType: 'system', direction: 'OUT' }),
  cat({ id: 'c-mine', name: 'Hobbies', ownerType: 'user', ownerId: 'me', direction: 'OUT' }),
  cat({ id: 'c-group', name: 'Household', ownerType: 'group', ownerId: 'g1', direction: 'OUT' }),
];

function makeBudget(p: Partial<BudgetSummary> = {}): BudgetSummary {
  return {
    id: p.id ?? 'b-1',
    name: p.name ?? 'Groceries',
    amountCents: p.amountCents ?? 80000,
    currency: p.currency ?? 'USD',
    scopeType: p.scopeType ?? 'personal',
    ownerId: p.ownerId !== undefined ? p.ownerId : 'me',
    groupId: p.groupId ?? null,
    categoryId: p.categoryId ?? null,
    category: p.category ?? null,
    period: p.period ?? 'MONTHLY',
    startsAt: p.startsAt ?? null,
    endsAt: p.endsAt ?? null,
    alertThresholdPct: p.alertThresholdPct !== undefined ? p.alertThresholdPct : null,
    alertOverspend: p.alertOverspend ?? true,
    archivedAt: null,
    createdById: 'me',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  };
}

function renderCreate(defaults?: React.ComponentProps<typeof BudgetFormDialog>['defaults']) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <BudgetFormDialog
      open
      mode="create"
      onClose={onClose}
      onSaved={onSaved}
      categories={DEFAULT_CATS}
      defaults={defaults}
    />,
  );
  return { onClose, onSaved };
}

function renderEdit(budget: BudgetSummary) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <BudgetFormDialog
      open
      mode="edit"
      budget={budget}
      onClose={onClose}
      onSaved={onSaved}
      categories={DEFAULT_CATS}
    />,
  );
  return { onClose, onSaved };
}

function fillBaseFields() {
  fireEvent.change(screen.getByTestId('budget-form-name'), { target: { value: 'Groceries' } });
  fireEvent.change(screen.getByTestId('budget-form-amount'), { target: { value: '800.00' } });
}

describe('BudgetFormDialog', () => {
  beforeEach(() => {
    createBudgetMock.mockReset();
    updateBudgetMock.mockReset();
    listCategoriesMock.mockReset();
    listCategoriesMock.mockResolvedValue(DEFAULT_CATS);
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Create mode — remember + defaults ──────────────────────────────────────

  it('create: remembered scope from remember.ts pre-checks the group', () => {
    localStorage.setItem(
      'myfin.budget.lastScope',
      JSON.stringify({ scope: 'group', groupId: 'g1' }),
    );
    renderCreate();
    expect((screen.getByTestId('scope-toggle-group-g1') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('scope-toggle-personal') as HTMLInputElement).checked).toBe(false);
  });

  it('create: defaults.scope overrides remember', () => {
    localStorage.setItem(
      'myfin.budget.lastScope',
      JSON.stringify({ scope: 'group', groupId: 'g1' }),
    );
    renderCreate({ scope: { scope: 'personal' } });
    expect((screen.getByTestId('scope-toggle-personal') as HTMLInputElement).checked).toBe(true);
  });

  it("create: currency defaults to the user's defaultCurrency", () => {
    renderCreate();
    const select = screen.getByTestId('budget-form-currency') as HTMLSelectElement;
    expect(select.value).toBe('USD');
    expect((select.options[0] as HTMLOptionElement).value).toBe('USD');
  });

  it("create: picking a group scope flips the currency to the group's default", () => {
    renderCreate();
    fireEvent.click(screen.getByTestId('scope-toggle-group-g1'));
    expect((screen.getByTestId('budget-form-currency') as HTMLSelectElement).value).toBe('ILS');
  });

  it('create: a manually picked currency does NOT follow the scope', () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('budget-form-currency'), { target: { value: 'EUR' } });
    fireEvent.click(screen.getByTestId('scope-toggle-group-g1'));
    expect((screen.getByTestId('budget-form-currency') as HTMLSelectElement).value).toBe('EUR');
  });

  // ── Scope — single-select over the multi-select selector ──────────────────

  it('create: checking a second scope replaces the first (single-select)', () => {
    renderCreate();
    expect((screen.getByTestId('scope-toggle-personal') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('scope-toggle-group-g1'));
    expect((screen.getByTestId('scope-toggle-group-g1') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('scope-toggle-personal') as HTMLInputElement).checked).toBe(false);
  });

  it('create: group scope narrows the category picker to system + group categories', () => {
    renderCreate();
    const options = () =>
      Array.from((screen.getByTestId('category-picker-select') as HTMLSelectElement).options).map(
        (o) => o.value,
      );
    expect(options()).toContain('c-mine');
    fireEvent.click(screen.getByTestId('scope-toggle-group-g1'));
    expect(options()).not.toContain('c-mine');
    expect(options()).toContain('c-group');
    expect(options()).toContain('c-out');
  });

  it('create: switching scope drops a category that is invisible in the new scope', () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('category-picker-select'), {
      target: { value: 'c-mine' },
    });
    fireEvent.click(screen.getByTestId('scope-toggle-group-g1'));
    expect((screen.getByTestId('category-picker-select') as HTMLSelectElement).value).toBe('');
  });

  // ── CUSTOM period disclosure ───────────────────────────────────────────────

  it('CUSTOM: the date-range disclosure is shown only for the CUSTOM period', () => {
    renderCreate();
    expect(screen.queryByTestId('budget-form-custom-range')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('budget-form-period'), { target: { value: 'CUSTOM' } });
    expect(screen.getByTestId('budget-form-custom-range')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('budget-form-period'), { target: { value: 'WEEKLY' } });
    expect(screen.queryByTestId('budget-form-custom-range')).not.toBeInTheDocument();
  });

  // ── Validation (mirrors the API DTO rules) ─────────────────────────────────

  it('validation: name required', async () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('budget-form-amount'), { target: { value: '10.00' } });
    fireEvent.click(screen.getByTestId('budget-form-save'));
    expect(await screen.findByTestId('budget-form-error-name')).toBeInTheDocument();
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it('validation: amount must be greater than zero', async () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('budget-form-name'), { target: { value: 'X' } });
    fireEvent.change(screen.getByTestId('budget-form-amount'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('budget-form-save'));
    expect(await screen.findByTestId('budget-form-error-amount')).toBeInTheDocument();
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it('validation: scope required after unchecking the last one', async () => {
    renderCreate();
    fillBaseFields();
    fireEvent.click(screen.getByTestId('scope-toggle-personal')); // uncheck default
    fireEvent.click(screen.getByTestId('budget-form-save'));
    expect(await screen.findByTestId('budget-form-error-scope')).toBeInTheDocument();
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it('validation: threshold outside 1..100 is rejected', async () => {
    renderCreate();
    fillBaseFields();
    fireEvent.change(screen.getByTestId('budget-form-threshold'), { target: { value: '150' } });
    fireEvent.click(screen.getByTestId('budget-form-save'));
    expect(await screen.findByTestId('budget-form-error-threshold')).toBeInTheDocument();
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it('validation: CUSTOM without dates flags both fields', async () => {
    renderCreate();
    fillBaseFields();
    fireEvent.change(screen.getByTestId('budget-form-period'), { target: { value: 'CUSTOM' } });
    fireEvent.click(screen.getByTestId('budget-form-save'));
    expect(await screen.findByTestId('budget-form-error-starts-at')).toBeInTheDocument();
    expect(screen.getByTestId('budget-form-error-ends-at')).toBeInTheDocument();
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it('validation: CUSTOM start must precede end', async () => {
    renderCreate();
    fillBaseFields();
    fireEvent.change(screen.getByTestId('budget-form-period'), { target: { value: 'CUSTOM' } });
    fireEvent.change(screen.getByTestId('budget-form-starts-at'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByTestId('budget-form-ends-at'), {
      target: { value: '2026-08-01' },
    });
    fireEvent.click(screen.getByTestId('budget-form-save'));
    expect(await screen.findByTestId('budget-form-error-ends-at')).toBeInTheDocument();
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  // ── Submit — success + error ───────────────────────────────────────────────

  it('create: save posts the minimal payload and persists the last-used scope', async () => {
    createBudgetMock.mockResolvedValueOnce(makeBudget({ id: 'new-1' }));
    const { onSaved, onClose } = renderCreate();
    fillBaseFields();
    fireEvent.click(screen.getByTestId('budget-form-save'));
    await waitFor(() => expect(createBudgetMock).toHaveBeenCalled());
    const payload = createBudgetMock.mock.calls[0][0];
    const signal = createBudgetMock.mock.calls[0][1];
    expect(payload).toEqual({
      name: 'Groceries',
      amountCents: 80000,
      currency: 'USD',
      scopeType: 'personal',
      period: 'MONTHLY',
      alertOverspend: true,
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem('myfin.budget.lastScope')).toContain('personal');
  });

  it('create: save posts the full payload (group scope, category, CUSTOM, threshold)', async () => {
    createBudgetMock.mockResolvedValueOnce(makeBudget({ id: 'new-2' }));
    renderCreate();
    fillBaseFields();
    fireEvent.click(screen.getByTestId('scope-toggle-group-g1'));
    fireEvent.change(screen.getByTestId('category-picker-select'), {
      target: { value: 'c-group' },
    });
    fireEvent.change(screen.getByTestId('budget-form-period'), { target: { value: 'CUSTOM' } });
    fireEvent.change(screen.getByTestId('budget-form-starts-at'), {
      target: { value: '2026-08-01' },
    });
    fireEvent.change(screen.getByTestId('budget-form-ends-at'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByTestId('budget-form-threshold'), { target: { value: '80' } });
    fireEvent.click(screen.getByTestId('budget-form-overspend'));
    fireEvent.click(screen.getByTestId('budget-form-save'));
    await waitFor(() => expect(createBudgetMock).toHaveBeenCalled());
    // Vitest pins TZ=UTC so the local-midnight → ISO conversion is deterministic.
    expect(createBudgetMock.mock.calls[0][0]).toEqual({
      name: 'Groceries',
      amountCents: 80000,
      currency: 'ILS',
      scopeType: 'group',
      groupId: 'g1',
      categoryId: 'c-group',
      period: 'CUSTOM',
      startsAt: '2026-08-01T00:00:00.000Z',
      endsAt: '2026-09-01T00:00:00.000Z',
      alertThresholdPct: 80,
      alertOverspend: false,
    });
  });

  it('create: API error is shown inline; dialog stays open', async () => {
    createBudgetMock.mockRejectedValueOnce(new Error('Boom'));
    const { onClose } = renderCreate();
    fillBaseFields();
    fireEvent.click(screen.getByTestId('budget-form-save'));
    expect(await screen.findByTestId('budget-form-api-error')).toHaveTextContent('Boom');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('create: BUDGET_INVALID_CATEGORY maps to a field error, not the banner', async () => {
    createBudgetMock.mockRejectedValueOnce(
      Object.assign(new Error('category not visible in scope'), {
        errorCode: 'BUDGET_INVALID_CATEGORY',
      }),
    );
    renderCreate();
    fillBaseFields();
    fireEvent.change(screen.getByTestId('category-picker-select'), {
      target: { value: 'c-out' },
    });
    fireEvent.click(screen.getByTestId('budget-form-save'));
    expect(await screen.findByTestId('budget-form-error-category')).toHaveTextContent(
      'category not visible in scope',
    );
    expect(screen.queryByTestId('budget-form-api-error')).not.toBeInTheDocument();
  });

  // ── Edit mode ──────────────────────────────────────────────────────────────

  it('edit: prefills fields from the budget', () => {
    renderEdit(makeBudget({ name: 'Fun', amountCents: 12345, alertThresholdPct: 75 }));
    expect((screen.getByTestId('budget-form-name') as HTMLInputElement).value).toBe('Fun');
    expect((screen.getByTestId('budget-form-amount') as HTMLInputElement).value).toBe('123.45');
    expect((screen.getByTestId('budget-form-threshold') as HTMLInputElement).value).toBe('75');
    expect((screen.getByTestId('budget-form-period') as HTMLSelectElement).value).toBe('MONTHLY');
  });

  it('edit: scope is locked (immutable per API design)', () => {
    renderEdit(makeBudget());
    expect((screen.getByTestId('scope-toggle-personal') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('budget-form-scope-locked')).toBeInTheDocument();
  });

  it('edit: diff only sends changed fields', async () => {
    updateBudgetMock.mockResolvedValueOnce(makeBudget({ name: 'Renamed' }));
    renderEdit(makeBudget());
    fireEvent.change(screen.getByTestId('budget-form-name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTestId('budget-form-save'));
    await waitFor(() => expect(updateBudgetMock).toHaveBeenCalled());
    const [id, diff] = updateBudgetMock.mock.calls[0];
    expect(id).toBe('b-1');
    expect(diff).toEqual({ name: 'Renamed' });
  });

  it('edit: clearing the threshold sends an explicit null', async () => {
    updateBudgetMock.mockResolvedValueOnce(makeBudget());
    renderEdit(makeBudget({ alertThresholdPct: 80 }));
    fireEvent.change(screen.getByTestId('budget-form-threshold'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('budget-form-save'));
    await waitFor(() => expect(updateBudgetMock).toHaveBeenCalled());
    expect(updateBudgetMock.mock.calls[0][1]).toEqual({ alertThresholdPct: null });
  });

  it('edit: switching CUSTOM → MONTHLY sends only the period (bounds auto-clear server-side)', async () => {
    updateBudgetMock.mockResolvedValueOnce(makeBudget({ period: 'MONTHLY' }));
    renderEdit(
      makeBudget({
        period: 'CUSTOM',
        startsAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2026-09-01T00:00:00.000Z',
      }),
    );
    fireEvent.change(screen.getByTestId('budget-form-period'), { target: { value: 'MONTHLY' } });
    fireEvent.click(screen.getByTestId('budget-form-save'));
    await waitFor(() => expect(updateBudgetMock).toHaveBeenCalled());
    expect(updateBudgetMock.mock.calls[0][1]).toEqual({ period: 'MONTHLY' });
  });

  it('edit: saving with no changes skips the PATCH and closes', async () => {
    const budget = makeBudget();
    const { onSaved, onClose } = renderEdit(budget);
    fireEvent.click(screen.getByTestId('budget-form-save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(budget));
    expect(updateBudgetMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  it('a11y: focuses the name input on open', async () => {
    renderCreate();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('budget-form-name')),
    );
  });

  it('a11y: ESC with no edits closes immediately', async () => {
    const { onClose } = renderCreate();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('a11y: ESC with edits shows the discard prompt', async () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('budget-form-name'), { target: { value: 'X' } });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.getByTestId('budget-form-discard-prompt')).toBeInTheDocument();
  });
});
