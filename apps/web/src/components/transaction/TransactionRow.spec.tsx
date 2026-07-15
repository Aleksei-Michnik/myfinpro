import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionRow } from './TransactionRow';
import enMessages from '@/../messages/en.json';
import type { TransactionSummary } from '@/lib/transaction/types';

const mockToggleStar = vi.fn();

// Resolve a dotted key against the loaded messages bundle. Returns the
// literal key when the path is missing (mirrors next-intl's fallback) so
// the doubled-prefix anti-pattern is observable in tests.
function resolveMessage(namespace: string | undefined, key: string): string {
  const path = (namespace ? `${namespace}.${key}` : key).split('.');
  let cur: unknown = enMessages;
  for (const seg of path) {
    if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return namespace ? `${namespace}.${key}` : key;
    }
  }
  return typeof cur === 'string' ? cur : namespace ? `${namespace}.${key}` : key;
}

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations:
    (namespace?: string) => (key: string, values?: Record<string, string | number>) => {
      const msg = resolveMessage(namespace, key);
      if (values && typeof values.count === 'number') {
        return `${msg}:${values.count}`;
      }
      return msg;
    },
}));

vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({
    toggleStar: mockToggleStar,
  }),
}));

function makeTransaction(p: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: p.id ?? 'p-1',
    direction: p.direction ?? 'OUT',
    type: 'ONE_TIME',
    amountCents: p.amountCents ?? 1234,
    currency: 'USD',
    occurredAt: '2026-04-25T00:00:00Z',
    status: 'POSTED',
    category: p.category ?? {
      id: 'c-1',
      slug: 'misc',
      name: 'Misc',
      icon: null,
      color: null,
    },
    attributions: p.attributions ?? [
      {
        scope: 'personal',
        userId: 'u-1',
        groupId: null,
        groupName: null,
      },
    ],
    note: p.note ?? null,
    commentCount: 0,
    starredByMe: p.starredByMe ?? false,
    hasDocuments: false,
    parentTransactionId: null,
    createdById: 'u-1',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  };
}

/** Wrap a `<TransactionRow variant="desktop">` in a table for valid HTML. */
function renderDesktop(props: Partial<Parameters<typeof TransactionRow>[0]> = {}) {
  return render(
    <table>
      <tbody>
        <TransactionRow
          transaction={props.transaction ?? makeTransaction()}
          variant="desktop"
          {...props}
        />
      </tbody>
    </table>,
  );
}

function renderCard(props: Partial<Parameters<typeof TransactionRow>[0]> = {}) {
  return render(
    <ul>
      <TransactionRow
        transaction={props.transaction ?? makeTransaction()}
        variant="card"
        {...props}
      />
    </ul>,
  );
}

describe('TransactionRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('desktop variant renders all 8 cells', () => {
    const { container } = renderDesktop();
    const tr = container.querySelector('tr') as HTMLTableRowElement;
    expect(tr).toBeTruthy();
    expect(tr.querySelectorAll('td').length).toBe(8);
  });

  it('card variant renders header amount + scopes block', () => {
    const transaction = makeTransaction({ note: 'Lunch' });
    renderCard({ transaction });
    expect(screen.getByTestId(`row-amount-${transaction.id}`)).toBeInTheDocument();
    // Regression for 6.15.2 — the rendered scope cell must be the resolved
    // human label "Personal", NOT the literal i18n key.
    const scopes = screen.getByTestId(`row-scopes-${transaction.id}`);
    expect(scopes).toHaveTextContent('Personal');
    expect(scopes.textContent).not.toMatch(/transactions\.transactions\./);
    expect(scopes.textContent).not.toMatch(/scope\.personal/);
  });

  it('star toggle: optimistic flip then sync with server response', async () => {
    mockToggleStar.mockResolvedValueOnce({ starred: true, starCount: 1 });
    const onStar = vi.fn();
    renderDesktop({ onStarToggled: onStar });
    const btn = screen.getByTestId('row-star-p-1');
    expect(btn.textContent).toBe('☆');
    fireEvent.click(btn);
    await waitFor(() => expect(onStar).toHaveBeenCalledWith('p-1', true));
    // After settle, button reflects the server state (no spinner).
    expect(btn.textContent).toBe('★');
    // Iteration 6.16.2 — toggleStar now receives an AbortSignal as 2nd arg.
    expect(mockToggleStar).toHaveBeenCalledWith('p-1', expect.any(AbortSignal));
  });

  it('star toggle: revert on error', async () => {
    mockToggleStar.mockRejectedValueOnce(new Error('boom'));
    renderDesktop();
    const btn = screen.getByTestId('row-star-p-1');
    expect(btn.textContent).toBe('☆');
    fireEvent.click(btn);
    await waitFor(() => expect(btn.textContent).toBe('☆'));
  });

  it('star toggle: button shows ButtonSpinner while in-flight (iteration 6.16.2)', async () => {
    let resolveFn: (v: { starred: boolean; starCount: number }) => void;
    mockToggleStar.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );
    renderDesktop();
    const btn = screen.getByTestId('row-star-p-1');
    fireEvent.click(btn);
    expect(screen.getByTestId('row-star-spinner-p-1')).toBeInTheDocument();
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      resolveFn!({ starred: true, starCount: 1 });
    });
    await waitFor(() =>
      expect(screen.queryByTestId('row-star-spinner-p-1')).not.toBeInTheDocument(),
    );
  });

  it('onEditClick fires with the transaction id', () => {
    const onEdit = vi.fn();
    renderDesktop({ onEditClick: onEdit });
    fireEvent.click(screen.getByTestId('row-controls-p-1'));
    fireEvent.click(screen.getByTestId('row-edit-p-1'));
    expect(onEdit).toHaveBeenCalledWith('p-1');
  });

  it('onDeleteClick fires with the full transaction payload', () => {
    const onDelete = vi.fn();
    const transaction = makeTransaction();
    renderDesktop({ transaction, onDeleteClick: onDelete });
    fireEvent.click(screen.getByTestId('row-controls-p-1'));
    fireEvent.click(screen.getByTestId('row-delete-p-1'));
    expect(onDelete).toHaveBeenCalledWith(transaction);
  });

  it('onAttachClick fires for an expense transaction and passes the payload', () => {
    const onAttach = vi.fn();
    const transaction = makeTransaction({ direction: 'OUT' });
    renderDesktop({ transaction, onAttachClick: onAttach });
    fireEvent.click(screen.getByTestId('row-controls-p-1'));
    fireEvent.click(screen.getByTestId('row-attach-p-1'));
    expect(onAttach).toHaveBeenCalledWith(transaction);
  });

  it('the attach action is hidden for income transactions', () => {
    renderDesktop({ transaction: makeTransaction({ direction: 'IN' }), onAttachClick: vi.fn() });
    fireEvent.click(screen.getByTestId('row-controls-p-1'));
    expect(screen.queryByTestId('row-attach-p-1')).not.toBeInTheDocument();
  });

  it('the attach action is absent when no handler is wired', () => {
    renderDesktop({ transaction: makeTransaction({ direction: 'OUT' }) });
    fireEvent.click(screen.getByTestId('row-controls-p-1'));
    expect(screen.queryByTestId('row-attach-p-1')).not.toBeInTheDocument();
  });

  it('onClick fires with the id when the row is clicked', () => {
    const onClick = vi.fn();
    renderDesktop({ onClick });
    fireEvent.click(screen.getByTestId('transaction-row-p-1'));
    expect(onClick).toHaveBeenCalledWith('p-1');
  });

  it('direction badge applies the green class for IN transactions', () => {
    renderDesktop({ transaction: makeTransaction({ direction: 'IN' }) });
    const pill = screen.getByTestId('row-direction-p-1');
    expect(pill.className).toMatch(/green/);
    expect(pill.dataset.direction).toBe('IN');
  });

  it('direction badge applies the red class for OUT transactions', () => {
    renderDesktop({ transaction: makeTransaction({ direction: 'OUT' }) });
    const pill = screen.getByTestId('row-direction-p-1');
    expect(pill.className).toMatch(/red/);
  });

  it('amount uses formatSignedAmount (sign + currency)', () => {
    renderDesktop({
      transaction: makeTransaction({ direction: 'OUT', amountCents: 1234 }),
    });
    expect(screen.getByTestId('row-amount-p-1').textContent).toMatch(/^-/);
    expect(screen.getByTestId('row-amount-p-1').textContent).toMatch(/12\.34/);
  });

  it('scope label resolves to the group name when given a group attribution', () => {
    const transaction = makeTransaction({
      attributions: [
        {
          scope: 'group',
          userId: null,
          groupId: 'g-1',
          groupName: 'Family',
        },
      ],
    });
    renderDesktop({ transaction });
    expect(screen.getByTestId('row-scopes-p-1').textContent).toBe('Family');
  });

  it('note is truncated and the title attribute carries the full text', () => {
    const transaction = makeTransaction({
      note: 'A very long note that should be truncated visually',
    });
    renderDesktop({ transaction });
    const noteEl = screen.getByTestId('row-note-p-1');
    expect(noteEl.className).toMatch(/truncate/);
    expect(noteEl.getAttribute('title')).toBe('A very long note that should be truncated visually');
  });

  it('showStar=false hides the star button', () => {
    renderDesktop({ showStar: false });
    expect(screen.queryByTestId('row-star-p-1')).not.toBeInTheDocument();
  });

  it('showControls=false hides the controls dropdown', () => {
    renderDesktop({ showControls: false });
    expect(screen.queryByTestId('row-controls-p-1')).not.toBeInTheDocument();
  });

  it('truncates a >3 scope list and exposes the full list via title', () => {
    const transaction = makeTransaction({
      attributions: [
        { scope: 'personal', userId: 'u-1', groupId: null, groupName: null },
        { scope: 'group', userId: null, groupId: 'g-1', groupName: 'A' },
        { scope: 'group', userId: null, groupId: 'g-2', groupName: 'B' },
        { scope: 'group', userId: null, groupId: 'g-3', groupName: 'C' },
        { scope: 'group', userId: null, groupId: 'g-4', groupName: 'D' },
      ],
    });
    renderDesktop({ transaction });
    const scopes = screen.getByTestId('row-scopes-p-1');
    expect(scopes.textContent).toMatch(/\+2/);
    expect(scopes.getAttribute('title')).toContain('D');
  });

  // ── Iteration 6.14 additions ─────────────────────────────────────────────

  it('row body click invokes onClick with the transaction id', () => {
    const onClick = vi.fn();
    renderDesktop({ onClick });
    fireEvent.click(screen.getByTestId('transaction-row-p-1'));
    expect(onClick).toHaveBeenCalledWith('p-1');
  });

  it('star click does not bubble up to the row onClick handler', () => {
    mockToggleStar.mockResolvedValueOnce({ starred: true, starCount: 1 });
    const onClick = vi.fn();
    renderDesktop({ onClick });
    fireEvent.click(screen.getByTestId('row-star-p-1'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('controls dropdown click does not bubble up to the row onClick handler', () => {
    const onClick = vi.fn();
    renderDesktop({ onClick });
    fireEvent.click(screen.getByTestId('row-controls-p-1'));
    expect(onClick).not.toHaveBeenCalled();
  });

  // ── Iteration 6.18.1.2 additions ─────────────────────────────────────────

  it('date cell renders the time-of-day component', () => {
    const transaction = makeTransaction();
    renderDesktop({ transaction });
    const tr = screen.getByTestId(`transaction-row-${transaction.id}`);
    // The date cell is the second `<td>` (after the star cell).
    const dateCell = tr.querySelectorAll('td')[1] as HTMLTableCellElement;
    expect(dateCell.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(dateCell.textContent).toMatch(/2026/);
  });

  it('Edit/Delete menu entries disabled for child occurrences', () => {
    const transaction = makeTransaction();
    // Override parentTransactionId so the helper reports a generated occurrence.
    const child: TransactionSummary = { ...transaction, parentTransactionId: 'parent-1' };
    renderDesktop({ transaction: child });
    fireEvent.click(screen.getByTestId(`row-controls-${child.id}`));
    expect(screen.getByTestId(`row-edit-${child.id}`)).toBeDisabled();
    expect(screen.getByTestId(`row-delete-${child.id}`)).toBeDisabled();
  });

  it('Edit/Delete menu entries disabled for unsupported types (INSTALLMENT)', () => {
    const transaction: TransactionSummary = { ...makeTransaction(), type: 'INSTALLMENT' };
    renderDesktop({ transaction });
    fireEvent.click(screen.getByTestId(`row-controls-${transaction.id}`));
    expect(screen.getByTestId(`row-edit-${transaction.id}`)).toBeDisabled();
    expect(screen.getByTestId(`row-delete-${transaction.id}`)).toBeDisabled();
  });

  it('Edit/Delete menu entries enabled for RECURRING parent', () => {
    const transaction: TransactionSummary = { ...makeTransaction(), type: 'RECURRING' };
    renderDesktop({ transaction });
    fireEvent.click(screen.getByTestId(`row-controls-${transaction.id}`));
    expect(screen.getByTestId(`row-edit-${transaction.id}`)).not.toBeDisabled();
    expect(screen.getByTestId(`row-delete-${transaction.id}`)).not.toBeDisabled();
  });
});
