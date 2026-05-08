import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentFormDialog } from './PaymentFormDialog';
import type { CategoryDto, PaymentSummary } from '@/lib/payment/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (values && typeof values.message === 'string') return `${key}:${values.message}`;
    if (values && typeof values.count === 'number') return `${key}:${values.count}`;
    if (values && typeof values.name === 'string') return `${key}:${values.name}`;
    return key;
  },
}));

const createPaymentMock = vi.fn();
const updatePaymentMock = vi.fn();
const listCategoriesMock = vi.fn();

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', defaultCurrency: 'USD' } }),
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({
    groups: [{ id: 'g1', name: 'Family', role: 'admin', defaultCurrency: 'USD' }],
  }),
}));

vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({
    createPayment: createPaymentMock,
    updatePayment: updatePaymentMock,
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
    direction: partial.direction ?? 'BOTH',
    ownerType: partial.ownerType ?? 'system',
    ownerId: partial.ownerId ?? null,
    isSystem: partial.ownerType === 'system',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

const DEFAULT_CATS: CategoryDto[] = [
  cat({ id: 'c-out', name: 'Food', ownerType: 'system', direction: 'OUT' }),
  cat({ id: 'c-in', name: 'Salary', ownerType: 'system', direction: 'IN' }),
  cat({ id: 'c-both', name: 'Misc', ownerType: 'system', direction: 'BOTH' }),
];

function makePayment(p: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    id: p.id ?? 'p-1',
    direction: p.direction ?? 'OUT',
    type: p.type ?? 'ONE_TIME',
    amountCents: p.amountCents ?? 1250,
    currency: p.currency ?? 'USD',
    occurredAt: p.occurredAt ?? '2026-04-25T00:00:00Z',
    status: 'POSTED',
    category: p.category ?? {
      id: 'c-out',
      slug: 'food',
      name: 'Food',
      icon: null,
      color: null,
    },
    attributions: p.attributions ?? [
      { scope: 'personal', userId: 'me', groupId: null, groupName: null },
    ],
    note: p.note ?? null,
    commentCount: 0,
    starredByMe: false,
    hasDocuments: false,
    parentPaymentId: p.parentPaymentId ?? null,
    createdById: 'me',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  };
}

function renderCreate(defaults?: React.ComponentProps<typeof PaymentFormDialog>['defaults']) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <PaymentFormDialog
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

function renderEdit(payment: PaymentSummary) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <PaymentFormDialog
      open
      mode="edit"
      payment={payment}
      onClose={onClose}
      onSaved={onSaved}
      categories={DEFAULT_CATS}
    />,
  );
  return { onClose, onSaved };
}

describe('PaymentFormDialog', () => {
  beforeEach(() => {
    createPaymentMock.mockReset();
    updatePaymentMock.mockReset();
    listCategoriesMock.mockReset();
    listCategoriesMock.mockResolvedValue(DEFAULT_CATS);
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Create mode ────────────────────────────────────────────────────────────

  it('create: defaults from remember.ts pre-fill last-used direction', () => {
    localStorage.setItem('myfin.payment.lastDirection', 'IN');
    renderCreate();
    expect(screen.getByTestId('form-direction-in').getAttribute('aria-pressed')).toBe('true');
  });

  it('create: defaults.direction overrides remember', () => {
    localStorage.setItem('myfin.payment.lastDirection', 'IN');
    renderCreate({ direction: 'OUT' });
    expect(screen.getByTestId('form-direction-out').getAttribute('aria-pressed')).toBe('true');
  });

  it('create: defaults.scope overrides remember', () => {
    localStorage.setItem(
      'myfin.payment.lastScopes',
      JSON.stringify([{ scope: 'group', groupId: 'g1' }]),
    );
    renderCreate({ scope: [{ scope: 'personal' }] });
    const personal = screen.getByTestId('scope-toggle-personal') as HTMLInputElement;
    expect(personal.checked).toBe(true);
  });

  it('create: validation — amount required', async () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25' } });
    fireEvent.change(screen.getByTestId('category-picker-select'), { target: { value: 'c-out' } });
    fireEvent.click(screen.getByTestId('form-save'));
    expect(await screen.findByTestId('form-error-amount')).toBeInTheDocument();
    expect(createPaymentMock).not.toHaveBeenCalled();
  });

  it('create: validation — category required', async () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '10.00' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25' } });
    fireEvent.click(screen.getByTestId('form-save'));
    expect(await screen.findByTestId('form-error-category')).toBeInTheDocument();
  });

  it('create: validation — category direction mismatch', async () => {
    renderCreate();
    // OUT direction by default
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '10.00' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25' } });
    fireEvent.change(screen.getByTestId('category-picker-select'), { target: { value: 'c-in' } });
    fireEvent.click(screen.getByTestId('form-save'));
    expect(await screen.findByTestId('form-error-category')).toBeInTheDocument();
  });

  it('create: validation — scopes required', async () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '10.00' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25' } });
    fireEvent.change(screen.getByTestId('category-picker-select'), { target: { value: 'c-out' } });
    // Uncheck the default personal scope.
    fireEvent.click(screen.getByTestId('scope-toggle-personal'));
    fireEvent.click(screen.getByTestId('form-save'));
    expect(await screen.findByTestId('form-error-scopes')).toBeInTheDocument();
  });

  it('create: validation — date ≤ now+1d', async () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '10.00' } });
    fireEvent.change(screen.getByTestId('category-picker-select'), { target: { value: 'c-out' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2099-01-01' } });
    fireEvent.click(screen.getByTestId('form-save'));
    expect(await screen.findByTestId('form-error-date')).toBeInTheDocument();
  });

  it('create: save calls createPayment with correct payload', async () => {
    createPaymentMock.mockResolvedValueOnce(makePayment({ id: 'new-1' }));
    const { onSaved, onClose } = renderCreate();
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '12.50' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25' } });
    fireEvent.change(screen.getByTestId('category-picker-select'), { target: { value: 'c-out' } });
    fireEvent.click(screen.getByTestId('form-save'));
    await waitFor(() => expect(createPaymentMock).toHaveBeenCalled());
    const payload = createPaymentMock.mock.calls[0][0];
    expect(payload.amountCents).toBe(1250);
    expect(payload.currency).toBe('USD');
    expect(payload.type).toBe('ONE_TIME');
    expect(payload.categoryId).toBe('c-out');
    expect(payload.attributions).toEqual([{ scope: 'personal' }]);
    expect(payload.occurredAt).toBe('2026-04-25T00:00:00Z');
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('create: save persists last-used values to localStorage', async () => {
    createPaymentMock.mockResolvedValueOnce(makePayment());
    renderCreate();
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '12.50' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25' } });
    fireEvent.change(screen.getByTestId('category-picker-select'), { target: { value: 'c-out' } });
    fireEvent.click(screen.getByTestId('form-save'));
    await waitFor(() => expect(createPaymentMock).toHaveBeenCalled());
    expect(localStorage.getItem('myfin.payment.lastDirection')).toBe('OUT');
    expect(localStorage.getItem('myfin.payment.lastType')).toBe('ONE_TIME');
    expect(localStorage.getItem('myfin.payment.lastScopes')).toContain('personal');
  });

  it('create: API error is shown inline; dialog stays open', async () => {
    createPaymentMock.mockRejectedValueOnce(new Error('Boom'));
    const { onClose } = renderCreate();
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '1.00' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25' } });
    fireEvent.change(screen.getByTestId('category-picker-select'), { target: { value: 'c-out' } });
    fireEvent.click(screen.getByTestId('form-save'));
    expect(await screen.findByTestId('form-api-error')).toHaveTextContent('Boom');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('create: currency dropdown contains USD first', () => {
    renderCreate();
    const select = screen.getByTestId('form-currency') as HTMLSelectElement;
    expect((select.options[0] as HTMLOptionElement).value).toBe('USD');
  });

  // ── Edit mode ─────────────────────────────────────────────────────────────

  it('edit: prefills fields from payment', () => {
    renderEdit(makePayment({ note: 'hello', amountCents: 3400 }));
    expect((screen.getByTestId('form-amount') as HTMLInputElement).value).toBe('34.00');
    expect((screen.getByTestId('form-date') as HTMLInputElement).value).toBe('2026-04-25');
    expect((screen.getByTestId('form-note') as HTMLTextAreaElement).value).toBe('hello');
  });

  it('edit: computeDiff only sends changed fields', async () => {
    updatePaymentMock.mockResolvedValueOnce(makePayment({ note: 'changed' }));
    renderEdit(makePayment({ note: 'orig' }));
    fireEvent.change(screen.getByTestId('form-note'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByTestId('form-save'));
    await waitFor(() => expect(updatePaymentMock).toHaveBeenCalled());
    const [id, diff] = updatePaymentMock.mock.calls[0];
    expect(id).toBe('p-1');
    expect(diff).toEqual({ note: 'changed' });
  });

  it('edit: changing scope emits attributions in diff', async () => {
    updatePaymentMock.mockResolvedValueOnce(makePayment());
    renderEdit(makePayment());
    fireEvent.click(screen.getByTestId('scope-toggle-group-g1')); // add group
    fireEvent.click(screen.getByTestId('form-save'));
    await waitFor(() => expect(updatePaymentMock).toHaveBeenCalled());
    const diff = updatePaymentMock.mock.calls[0][1];
    expect(diff.attributions).toEqual([{ scope: 'personal' }, { scope: 'group', groupId: 'g1' }]);
  });

  it('edit: generated occurrence (parentPaymentId) shows banner, Save disabled', () => {
    renderEdit(makePayment({ parentPaymentId: 'parent-1' }));
    expect(screen.getByTestId('payment-form-occurrence-banner')).toBeInTheDocument();
    expect((screen.getByTestId('form-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('edit: generated occurrence (type!=ONE_TIME) shows banner', () => {
    renderEdit(makePayment({ type: 'RECURRING' }));
    expect(screen.getByTestId('payment-form-occurrence-banner')).toBeInTheDocument();
  });

  it('edit: non-accessible attributions show read-only footnote', () => {
    renderEdit(
      makePayment({
        attributions: [
          { scope: 'personal', userId: 'me', groupId: null, groupName: null },
          { scope: 'personal', userId: 'other', groupId: null, groupName: null },
        ],
      }),
    );
    expect(screen.getByTestId('form-non-accessible-footnote')).toBeInTheDocument();
  });

  it('edit: API error path shows error', async () => {
    updatePaymentMock.mockRejectedValueOnce(new Error('BadRequest'));
    const { onClose } = renderEdit(makePayment({ note: 'orig' }));
    fireEvent.change(screen.getByTestId('form-note'), { target: { value: 'new' } });
    fireEvent.click(screen.getByTestId('form-save'));
    expect(await screen.findByTestId('form-api-error')).toHaveTextContent('BadRequest');
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Accessibility ─────────────────────────────────────────────────────────

  it('a11y: focuses Direction (IN) button on open', async () => {
    renderCreate();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('form-direction-in')),
    );
  });

  it('a11y: ESC with no edits closes immediately', async () => {
    const { onClose } = renderCreate();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('a11y: ESC with edits shows discard prompt', async () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '10.00' } });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.getByTestId('form-discard-prompt')).toBeInTheDocument();
  });
});
