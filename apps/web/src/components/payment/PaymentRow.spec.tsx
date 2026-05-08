import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentRow } from './PaymentRow';
import type { PaymentSummary } from '@/lib/payment/types';

const mockToggleStar = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (values && typeof values.count === 'number') {
      return `${key}:${values.count}`;
    }
    return key;
  },
}));

vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({
    toggleStar: mockToggleStar,
  }),
}));

function makePayment(p: Partial<PaymentSummary> = {}): PaymentSummary {
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
    parentPaymentId: null,
    createdById: 'u-1',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  };
}

/** Wrap a `<PaymentRow variant="desktop">` in a table for valid HTML. */
function renderDesktop(props: Partial<Parameters<typeof PaymentRow>[0]> = {}) {
  return render(
    <table>
      <tbody>
        <PaymentRow payment={props.payment ?? makePayment()} variant="desktop" {...props} />
      </tbody>
    </table>,
  );
}

function renderCard(props: Partial<Parameters<typeof PaymentRow>[0]> = {}) {
  return render(
    <ul>
      <PaymentRow payment={props.payment ?? makePayment()} variant="card" {...props} />
    </ul>,
  );
}

describe('PaymentRow', () => {
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
    const payment = makePayment({ note: 'Lunch' });
    renderCard({ payment });
    expect(screen.getByTestId(`row-amount-${payment.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`row-scopes-${payment.id}`)).toHaveTextContent('scope.personal');
  });

  it('star toggle: optimistic flip then sync with server response', async () => {
    mockToggleStar.mockResolvedValueOnce({ starred: true, starCount: 1 });
    const onStar = vi.fn();
    renderDesktop({ onStarToggled: onStar });
    const btn = screen.getByTestId('row-star-p-1');
    expect(btn.textContent).toBe('☆');
    fireEvent.click(btn);
    // Optimistic: immediately filled.
    expect(btn.textContent).toBe('★');
    await waitFor(() => expect(onStar).toHaveBeenCalledWith('p-1', true));
  });

  it('star toggle: revert on error', async () => {
    mockToggleStar.mockRejectedValueOnce(new Error('boom'));
    renderDesktop();
    const btn = screen.getByTestId('row-star-p-1');
    expect(btn.textContent).toBe('☆');
    fireEvent.click(btn);
    expect(btn.textContent).toBe('★'); // optimistic
    await waitFor(() => expect(btn.textContent).toBe('☆'));
  });

  it('onEditClick fires with the payment id', () => {
    const onEdit = vi.fn();
    renderDesktop({ onEditClick: onEdit });
    fireEvent.click(screen.getByTestId('row-controls-p-1'));
    fireEvent.click(screen.getByTestId('row-edit-p-1'));
    expect(onEdit).toHaveBeenCalledWith('p-1');
  });

  it('onDeleteClick fires with the full payment payload', () => {
    const onDelete = vi.fn();
    const payment = makePayment();
    renderDesktop({ payment, onDeleteClick: onDelete });
    fireEvent.click(screen.getByTestId('row-controls-p-1'));
    fireEvent.click(screen.getByTestId('row-delete-p-1'));
    expect(onDelete).toHaveBeenCalledWith(payment);
  });

  it('onClick fires with the id when the row is clicked', () => {
    const onClick = vi.fn();
    renderDesktop({ onClick });
    fireEvent.click(screen.getByTestId('payment-row-p-1'));
    expect(onClick).toHaveBeenCalledWith('p-1');
  });

  it('direction badge applies the green class for IN payments', () => {
    renderDesktop({ payment: makePayment({ direction: 'IN' }) });
    const pill = screen.getByTestId('row-direction-p-1');
    expect(pill.className).toMatch(/green/);
    expect(pill.dataset.direction).toBe('IN');
  });

  it('direction badge applies the red class for OUT payments', () => {
    renderDesktop({ payment: makePayment({ direction: 'OUT' }) });
    const pill = screen.getByTestId('row-direction-p-1');
    expect(pill.className).toMatch(/red/);
  });

  it('amount uses formatSignedAmount (sign + currency)', () => {
    renderDesktop({
      payment: makePayment({ direction: 'OUT', amountCents: 1234 }),
    });
    expect(screen.getByTestId('row-amount-p-1').textContent).toMatch(/^-/);
    expect(screen.getByTestId('row-amount-p-1').textContent).toMatch(/12\.34/);
  });

  it('scope label resolves to the group name when given a group attribution', () => {
    const payment = makePayment({
      attributions: [
        {
          scope: 'group',
          userId: null,
          groupId: 'g-1',
          groupName: 'Family',
        },
      ],
    });
    renderDesktop({ payment });
    expect(screen.getByTestId('row-scopes-p-1').textContent).toBe('Family');
  });

  it('note is truncated and the title attribute carries the full text', () => {
    const payment = makePayment({
      note: 'A very long note that should be truncated visually',
    });
    renderDesktop({ payment });
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
    const payment = makePayment({
      attributions: [
        { scope: 'personal', userId: 'u-1', groupId: null, groupName: null },
        { scope: 'group', userId: null, groupId: 'g-1', groupName: 'A' },
        { scope: 'group', userId: null, groupId: 'g-2', groupName: 'B' },
        { scope: 'group', userId: null, groupId: 'g-3', groupName: 'C' },
        { scope: 'group', userId: null, groupId: 'g-4', groupName: 'D' },
      ],
    });
    renderDesktop({ payment });
    const scopes = screen.getByTestId('row-scopes-p-1');
    expect(scopes.textContent).toMatch(/\+2/);
    expect(scopes.getAttribute('title')).toContain('D');
  });

  // ── Iteration 6.14 additions ─────────────────────────────────────────────

  it('row body click invokes onClick with the payment id', () => {
    const onClick = vi.fn();
    renderDesktop({ onClick });
    fireEvent.click(screen.getByTestId('payment-row-p-1'));
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
});
