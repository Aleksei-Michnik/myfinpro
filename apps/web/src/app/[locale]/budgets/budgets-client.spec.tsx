import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetsClient } from './budgets-client';
import type { BudgetSummary } from '@/lib/budget/types';
import type { RealtimeEvent } from '@/lib/realtime/realtime-types';

// Tests for the iteration 10.4 orchestrator: cards, scope filter tabs bound
// to committed state, show-archived toggle, cursor "load more", the
// edit/delete/archive flows, and the realtime refetches.

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));

const fetchBudgetsMock = vi.fn();
const deleteBudgetMock = vi.fn();
const archiveBudgetMock = vi.fn();
const unarchiveBudgetMock = vi.fn();
const addToastMock = vi.fn();

vi.mock('@/lib/budget/budget-context', () => ({
  useBudgets: () => ({
    fetchBudgets: fetchBudgetsMock,
    deleteBudget: deleteBudgetMock,
    archiveBudget: archiveBudgetMock,
    unarchiveBudget: unarchiveBudgetMock,
  }),
}));

// One admin group and one member group so the role gating is observable.
vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({
    groups: [
      { id: 'g1', name: 'Family', role: 'admin' },
      { id: 'g2', name: 'Roomies', role: 'member' },
    ],
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

// The form dialogs have their own specs — stub them to observable shells.
vi.mock('@/components/budget/BudgetFormDialog', () => ({
  BudgetFormDialog: (props: {
    mode: string;
    budget?: BudgetSummary;
    onSaved(b: BudgetSummary): void;
  }) => (
    <div data-testid="budget-form-dialog-mock" data-mode={props.mode}>
      <span data-testid="budget-form-dialog-budget">{props.budget?.id}</span>
      <button
        type="button"
        data-testid="budget-form-dialog-save"
        onClick={() => props.onSaved({ ...props.budget!, name: 'Renamed' })}
      >
        save
      </button>
    </div>
  ),
}));
vi.mock('@/components/budget/CreateBudgetDialog', () => ({
  CreateBudgetDialog: (props: { open: boolean; onCreated(b: BudgetSummary): void }) =>
    props.open ? (
      <button
        type="button"
        data-testid="create-budget-dialog-created"
        onClick={() => props.onCreated(makeBudget({ id: 'b-new' }))}
      >
        created
      </button>
    ) : null,
}));

// Capture realtime handlers so tests can emit events / trigger resyncs.
type Handler = (event: RealtimeEvent) => void;
const realtimeHandlers: { filter: { type: string }; handler: Handler }[] = [];
vi.mock('@/lib/realtime/use-realtime-events', () => ({
  useRealtimeEvents: (filter: { type: string }, handler: Handler) => {
    realtimeHandlers.push({ filter, handler });
  },
}));
const resyncCallbacks: (() => void)[] = [];
vi.mock('@/lib/realtime/use-realtime-resync', () => ({
  useRealtimeResync: (cb: () => void) => {
    resyncCallbacks.push(cb);
  },
}));

// The capture array grows on every render — deliver to the latest handler
// only, modeling the single live subscription the real hook keeps.
const emit = (event: RealtimeEvent) =>
  act(() => {
    const matching = realtimeHandlers.filter((h) => h.filter.type === event.type);
    matching[matching.length - 1]?.handler(event);
  });

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeBudget(p: Partial<BudgetSummary> = {}): BudgetSummary {
  return {
    id: 'b1',
    name: 'Groceries',
    amountCents: 80000,
    currency: 'USD',
    scopeType: 'personal',
    ownerId: 'me',
    groupId: null,
    categoryId: null,
    category: null,
    period: 'MONTHLY',
    startsAt: null,
    endsAt: null,
    alertThresholdPct: null,
    alertOverspend: true,
    archivedAt: null,
    createdById: 'me',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    ...p,
  };
}

const page = (data: BudgetSummary[], nextCursor: string | null = null) => ({
  data,
  nextCursor,
  hasMore: nextCursor !== null,
});

/** Open the ⋮ menu of a card and click one of its items. */
async function clickCardAction(budgetId: string, action: 'edit' | 'archive' | 'delete') {
  fireEvent.click(screen.getByTestId(`budget-actions-${budgetId}`));
  await waitFor(() =>
    expect(screen.getByTestId(`budget-${action}-${budgetId}`)).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByTestId(`budget-${action}-${budgetId}`));
}

describe('BudgetsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtimeHandlers.length = 0;
    resyncCallbacks.length = 0;
    fetchBudgetsMock.mockResolvedValue(page([]));
  });

  it('renders cards with name, amount, scope chip, category chip, and period', async () => {
    fetchBudgetsMock.mockResolvedValue(
      page([
        makeBudget({
          id: 'b1',
          category: { id: 'c1', slug: 'food', name: 'Food', icon: '🍞', color: null },
        }),
        makeBudget({ id: 'b2', scopeType: 'group', ownerId: null, groupId: 'g1' }),
      ]),
    );
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument());

    expect(screen.getByTestId('budget-name-b1').textContent).toBe('Groceries');
    expect(screen.getByTestId('budget-amount-b1').textContent).toBe('$800.00');
    expect(screen.getByTestId('budget-scope-b1').textContent).toBe('scope.personal');
    expect(screen.getByTestId('budget-category-b1').textContent).toBe('🍞 Food');
    expect(screen.getByTestId('budget-period-b1').textContent).toBe('form.periods.MONTHLY');

    // Group budget: scope chip shows the group name, no category → "all".
    expect(screen.getByTestId('budget-scope-b2').textContent).toBe('Family');
    expect(screen.getByTestId('budget-category-b2').textContent).toBe('form.categoryAll');
  });

  it('CUSTOM budgets render the date range as the period label', async () => {
    fetchBudgetsMock.mockResolvedValue(
      page([
        makeBudget({
          period: 'CUSTOM',
          startsAt: '2026-07-01T00:00:00Z',
          endsAt: '2026-08-01T00:00:00Z',
        }),
      ]),
    );
    render(<BudgetsClient />);
    await waitFor(() =>
      // The next-intl mock renders the key; the real render interpolates
      // {start}/{end} from formatOccurredDate.
      expect(screen.getByTestId('budget-period-b1').textContent).toBe('list.customRange'),
    );
  });

  it('shows the empty state when there are no budgets', async () => {
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budgets-empty')).toBeInTheDocument());
  });

  it('scope tabs commit only after the fetch succeeds and map to scope=', async () => {
    fetchBudgetsMock.mockResolvedValueOnce(page([makeBudget()]));
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument());
    expect(screen.getByTestId('scope-tab-all')).toHaveAttribute('aria-selected', 'true');

    // Hold the personal fetch open: the tab must NOT advance pre-commit.
    let resolveFetch!: (v: unknown) => void;
    fetchBudgetsMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFetch = resolve)),
    );
    fireEvent.click(screen.getByTestId('scope-tab-personal'));
    expect(screen.getByTestId('scope-tab-all')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('scope-tab-personal')).toHaveAttribute('aria-selected', 'false');
    expect(fetchBudgetsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: 'personal', limit: 20 }),
      expect.anything(),
    );

    await act(async () => {
      resolveFetch(page([]));
    });
    await waitFor(() =>
      expect(screen.getByTestId('scope-tab-personal')).toHaveAttribute('aria-selected', 'true'),
    );

    // Group tab maps to scope=group:<id>.
    fetchBudgetsMock.mockResolvedValueOnce(page([]));
    fireEvent.click(screen.getByTestId('scope-tab-group:g1'));
    await waitFor(() =>
      expect(fetchBudgetsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: 'group:g1' }),
        expect.anything(),
      ),
    );
  });

  it('the archived toggle maps to includeArchived= and styles archived cards', async () => {
    fetchBudgetsMock.mockResolvedValueOnce(page([makeBudget()]));
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument());
    expect(screen.getByTestId('budgets-archived-toggle')).toHaveAttribute('aria-pressed', 'false');

    fetchBudgetsMock.mockResolvedValueOnce(
      page([makeBudget(), makeBudget({ id: 'b-arch', archivedAt: '2026-07-10T00:00:00Z' })]),
    );
    fireEvent.click(screen.getByTestId('budgets-archived-toggle'));
    await waitFor(() =>
      expect(fetchBudgetsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ includeArchived: true }),
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('budgets-archived-toggle')).toHaveAttribute('aria-pressed', 'true'),
    );

    const archivedCard = screen.getByTestId('budget-card-b-arch');
    expect(archivedCard).toHaveAttribute('data-archived', 'true');
    expect(screen.getByTestId('budget-archived-b-arch')).toBeInTheDocument();
    expect(screen.queryByTestId('budget-archived-b1')).not.toBeInTheDocument();

    // Toggling back drops the param again.
    fetchBudgetsMock.mockResolvedValueOnce(page([makeBudget()]));
    fireEvent.click(screen.getByTestId('budgets-archived-toggle'));
    await waitFor(() =>
      expect(fetchBudgetsMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ includeArchived: undefined }),
        expect.anything(),
      ),
    );
  });

  it('paginates with the cursor and dedupes', async () => {
    fetchBudgetsMock.mockResolvedValueOnce(page([makeBudget({ id: 'b1' })], 'CURSOR'));
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budgets-load-more')).toBeInTheDocument());

    fetchBudgetsMock.mockResolvedValueOnce(
      page([makeBudget({ id: 'b1' }), makeBudget({ id: 'b2' })], null),
    );
    fireEvent.click(screen.getByTestId('budgets-load-more'));
    await waitFor(() => expect(screen.getByTestId('budget-card-b2')).toBeInTheDocument());
    expect(fetchBudgetsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'CURSOR', limit: 20 }),
      expect.anything(),
    );
    expect(screen.getAllByTestId(/^budget-card-/)).toHaveLength(2);
    expect(screen.queryByTestId('budgets-load-more')).not.toBeInTheDocument();
  });

  it('edit opens the form dialog in edit mode and replaces the card on save', async () => {
    fetchBudgetsMock.mockResolvedValue(page([makeBudget()]));
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument());

    await clickCardAction('b1', 'edit');
    const dialog = screen.getByTestId('budget-form-dialog-mock');
    expect(dialog).toHaveAttribute('data-mode', 'edit');
    expect(screen.getByTestId('budget-form-dialog-budget').textContent).toBe('b1');

    fireEvent.click(screen.getByTestId('budget-form-dialog-save'));
    await waitFor(() => expect(screen.getByTestId('budget-name-b1').textContent).toBe('Renamed'));
    expect(screen.queryByTestId('budget-form-dialog-mock')).not.toBeInTheDocument();
  });

  it('edit is disabled on archived budgets (unarchive first)', async () => {
    fetchBudgetsMock.mockResolvedValue(page([makeBudget({ archivedAt: '2026-07-10T00:00:00Z' })]));
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('budget-actions-b1'));
    await waitFor(() => expect(screen.getByTestId('budget-edit-b1')).toBeInTheDocument());
    expect(screen.getByTestId('budget-edit-b1')).toBeDisabled();
    expect(screen.getByTestId('budget-archive-b1')).not.toBeDisabled();
  });

  it('group budgets hide the actions menu from non-admin members', async () => {
    fetchBudgetsMock.mockResolvedValue(
      page([
        makeBudget({ id: 'b-admin', scopeType: 'group', ownerId: null, groupId: 'g1' }),
        makeBudget({ id: 'b-member', scopeType: 'group', ownerId: null, groupId: 'g2' }),
      ]),
    );
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budget-card-b-member')).toBeInTheDocument());
    expect(screen.getByTestId('budget-actions-b-admin')).toBeInTheDocument();
    expect(screen.queryByTestId('budget-actions-b-member')).not.toBeInTheDocument();
  });

  it('delete asks for confirmation, calls the API, and removes the card', async () => {
    fetchBudgetsMock.mockResolvedValue(page([makeBudget()]));
    deleteBudgetMock.mockResolvedValue(undefined);
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument());

    await clickCardAction('b1', 'delete');
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(deleteBudgetMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    await waitFor(() => expect(deleteBudgetMock).toHaveBeenCalledWith('b1', expect.anything()));
    await waitFor(() => expect(screen.queryByTestId('budget-card-b1')).not.toBeInTheDocument());
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(addToastMock).toHaveBeenCalledWith('success', 'deletedToast');
  });

  it('cancelling the delete confirmation keeps the budget', async () => {
    fetchBudgetsMock.mockResolvedValue(page([makeBudget()]));
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument());

    await clickCardAction('b1', 'delete');
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    expect(deleteBudgetMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument();
  });

  it('archiving removes the card from a hide-archived list and toasts', async () => {
    fetchBudgetsMock.mockResolvedValue(page([makeBudget()]));
    archiveBudgetMock.mockResolvedValue(makeBudget({ archivedAt: '2026-07-17T00:00:00Z' }));
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument());

    await clickCardAction('b1', 'archive');
    await waitFor(() => expect(archiveBudgetMock).toHaveBeenCalledWith('b1', expect.anything()));
    await waitFor(() => expect(screen.queryByTestId('budget-card-b1')).not.toBeInTheDocument());
    expect(addToastMock).toHaveBeenCalledWith('success', 'archivedToast');
  });

  it('unarchiving replaces the card in place and toasts', async () => {
    // Committed filters include archived budgets, so the card stays visible.
    fetchBudgetsMock
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([makeBudget({ archivedAt: '2026-07-10T00:00:00Z' })]));
    unarchiveBudgetMock.mockResolvedValue(makeBudget());
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budgets-empty')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('budgets-archived-toggle'));
    await waitFor(() => expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument());
    expect(screen.getByTestId('budget-card-b1')).toHaveAttribute('data-archived', 'true');

    await clickCardAction('b1', 'archive');
    await waitFor(() => expect(unarchiveBudgetMock).toHaveBeenCalledWith('b1', expect.anything()));
    await waitFor(() =>
      expect(screen.getByTestId('budget-card-b1')).not.toHaveAttribute('data-archived'),
    );
    expect(addToastMock).toHaveBeenCalledWith('success', 'unarchivedToast');
  });

  it('a failed archive surfaces an error toast and keeps the card', async () => {
    fetchBudgetsMock.mockResolvedValue(page([makeBudget()]));
    archiveBudgetMock.mockRejectedValue(new Error('boom'));
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument());

    await clickCardAction('b1', 'archive');
    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('boom')),
    );
    expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument();
  });

  it('refetches with the committed filters on budget.updated SSE events', async () => {
    fetchBudgetsMock.mockResolvedValueOnce(page([]));
    render(<BudgetsClient />);
    await waitFor(() => expect(fetchBudgetsMock).toHaveBeenCalledTimes(1));

    // Commit a filter first so the refetch provably reuses it.
    fetchBudgetsMock.mockResolvedValueOnce(page([]));
    fireEvent.click(screen.getByTestId('scope-tab-personal'));
    await waitFor(() => expect(fetchBudgetsMock).toHaveBeenCalledTimes(2));

    fetchBudgetsMock.mockResolvedValueOnce(page([makeBudget()]));
    emit({ type: 'budget.updated', budgetId: 'b1' });
    await waitFor(() => expect(fetchBudgetsMock).toHaveBeenCalledTimes(3));
    expect(fetchBudgetsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: 'personal', cursor: undefined }),
      expect.anything(),
    );
    await waitFor(() => expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument());
  });

  it('refetches the committed first page on realtime resync', async () => {
    render(<BudgetsClient />);
    await waitFor(() => expect(fetchBudgetsMock).toHaveBeenCalledTimes(1));
    act(() => resyncCallbacks[resyncCallbacks.length - 1]!());
    await waitFor(() => expect(fetchBudgetsMock).toHaveBeenCalledTimes(2));
  });

  it('a failed list fetch opens the recovery dialog; Retry re-issues it', async () => {
    fetchBudgetsMock.mockRejectedValueOnce(new Error('down'));
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('retry-return-dialog')).toBeInTheDocument());

    fetchBudgetsMock.mockResolvedValueOnce(page([makeBudget()]));
    fireEvent.click(screen.getByTestId('retry-return-dialog-retry'));
    await waitFor(() => expect(screen.getByTestId('budget-card-b1')).toBeInTheDocument());
    expect(screen.queryByTestId('retry-return-dialog')).not.toBeInTheDocument();
  });

  it('creating a budget refetches the committed first page', async () => {
    fetchBudgetsMock.mockResolvedValueOnce(page([]));
    render(<BudgetsClient />);
    await waitFor(() => expect(screen.getByTestId('budgets-empty')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('budgets-new'));
    fetchBudgetsMock.mockResolvedValueOnce(page([makeBudget({ id: 'b-new' })]));
    fireEvent.click(screen.getByTestId('create-budget-dialog-created'));
    await waitFor(() => expect(screen.getByTestId('budget-card-b-new')).toBeInTheDocument());
  });
});
