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
const removePaymentMock = vi.fn();
const listCategoriesMock = vi.fn();
const createScheduleMock = vi.fn();
const replaceScheduleMock = vi.fn();

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
    removePayment: removePaymentMock,
    listCategories: listCategoriesMock,
    createSchedule: createScheduleMock,
    replaceSchedule: replaceScheduleMock,
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
    removePaymentMock.mockReset();
    listCategoriesMock.mockReset();
    listCategoriesMock.mockResolvedValue(DEFAULT_CATS);
    createScheduleMock.mockReset();
    replaceScheduleMock.mockReset();
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
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25T00:00' } });
    fireEvent.change(screen.getByTestId('category-picker-select'), { target: { value: 'c-out' } });
    fireEvent.click(screen.getByTestId('form-save'));
    expect(await screen.findByTestId('form-error-amount')).toBeInTheDocument();
    expect(createPaymentMock).not.toHaveBeenCalled();
  });

  it('create: validation — category required', async () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '10.00' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25T00:00' } });
    fireEvent.click(screen.getByTestId('form-save'));
    expect(await screen.findByTestId('form-error-category')).toBeInTheDocument();
  });

  it('create: validation — category direction mismatch', async () => {
    renderCreate();
    // OUT direction by default
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '10.00' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25T00:00' } });
    fireEvent.change(screen.getByTestId('category-picker-select'), { target: { value: 'c-in' } });
    fireEvent.click(screen.getByTestId('form-save'));
    expect(await screen.findByTestId('form-error-category')).toBeInTheDocument();
  });

  it('create: validation — scopes required', async () => {
    renderCreate();
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '10.00' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25T00:00' } });
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
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25T00:00' } });
    fireEvent.change(screen.getByTestId('category-picker-select'), { target: { value: 'c-out' } });
    fireEvent.click(screen.getByTestId('form-save'));
    await waitFor(() => expect(createPaymentMock).toHaveBeenCalled());
    const payload = createPaymentMock.mock.calls[0][0];
    const signal = createPaymentMock.mock.calls[0][1];
    expect(payload.amountCents).toBe(1250);
    expect(payload.currency).toBe('USD');
    expect(payload.type).toBe('ONE_TIME');
    expect(payload.categoryId).toBe('c-out');
    expect(payload.attributions).toEqual([{ scope: 'personal' }]);
    // Phase 6 · Iteration 6.18.1.2 — datetime-local → UTC ISO conversion
    // now goes through `Date.prototype.toISOString()`, which always emits
    // millisecond precision. (Vitest pins TZ=UTC so this is deterministic.)
    expect(payload.occurredAt).toBe('2026-04-25T00:00:00.000Z');
    expect(signal).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('create: save persists last-used values to localStorage', async () => {
    createPaymentMock.mockResolvedValueOnce(makePayment());
    renderCreate();
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '12.50' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25T00:00' } });
    fireEvent.change(screen.getByTestId('category-picker-select'), { target: { value: 'c-out' } });
    fireEvent.click(screen.getByTestId('form-save'));
    await waitFor(() => expect(createPaymentMock).toHaveBeenCalled());
    await waitFor(() => expect(localStorage.getItem('myfin.payment.lastDirection')).toBe('OUT'));
    expect(localStorage.getItem('myfin.payment.lastType')).toBe('ONE_TIME');
    expect(localStorage.getItem('myfin.payment.lastScopes')).toContain('personal');
  });

  it('create: API error is shown inline; dialog stays open', async () => {
    createPaymentMock.mockRejectedValueOnce(new Error('Boom'));
    const { onClose } = renderCreate();
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '1.00' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25T00:00' } });
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

  // Phase 6 · Iteration 6.18.1.2 — date input is a `datetime-local`
  // picker so users can specify the time of day for `occurredAt`.
  it('create: date input is type=datetime-local with a sensible default', () => {
    renderCreate();
    const dateInput = screen.getByTestId('form-date') as HTMLInputElement;
    expect(dateInput.type).toBe('datetime-local');
    // Default value follows the YYYY-MM-DDTHH:mm shape (current local time).
    expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  // ── Edit mode ─────────────────────────────────────────────────────────────

  it('edit: prefills fields from payment', () => {
    renderEdit(makePayment({ note: 'hello', amountCents: 3400 }));
    expect((screen.getByTestId('form-amount') as HTMLInputElement).value).toBe('34.00');
    // datetime-local input — `YYYY-MM-DDTHH:mm`. Phase 6 · Iteration 6.18.1.2.
    expect((screen.getByTestId('form-date') as HTMLInputElement).value).toBe('2026-04-25T00:00');
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

  it('edit: still-unsupported type (INSTALLMENT) shows banner', () => {
    renderEdit(makePayment({ type: 'INSTALLMENT' }));
    expect(screen.getByTestId('payment-form-occurrence-banner')).toBeInTheDocument();
  });

  it('edit: RECURRING parent is editable in 6.18.1 (no occurrence banner)', () => {
    renderEdit(makePayment({ type: 'RECURRING' }));
    expect(screen.queryByTestId('payment-form-occurrence-banner')).not.toBeInTheDocument();
    expect((screen.getByTestId('form-save') as HTMLButtonElement).disabled).toBe(false);
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

  // ── 6.18.1 — RECURRING flow ───────────────────────────────────────────────

  function fillBaseFields() {
    fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '50.00' } });
    fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-25T00:00' } });
    fireEvent.change(screen.getByTestId('category-picker-select'), {
      target: { value: 'c-out' },
    });
  }

  function pickRecurring() {
    // Expand advanced section, then click RECURRING radio.
    fireEvent.click(screen.getByTestId('type-disclosure-toggle'));
    fireEvent.click(screen.getByTestId('type-radio-RECURRING'));
  }

  it('recurring: picking RECURRING reveals the schedule sub-form', () => {
    renderCreate();
    expect(screen.queryByTestId('payment-schedule-subform')).not.toBeInTheDocument();
    pickRecurring();
    expect(screen.getByTestId('payment-schedule-subform')).toBeInTheDocument();
  });

  it('recurring create: posts payment then schedule in sequence', async () => {
    createPaymentMock.mockResolvedValueOnce(makePayment({ id: 'new-1', type: 'RECURRING' }));
    createScheduleMock.mockResolvedValueOnce({ id: 's-1' });
    const { onSaved, onClose } = renderCreate();
    fillBaseFields();
    pickRecurring();
    fireEvent.click(screen.getByTestId('form-save'));
    await waitFor(() => expect(createScheduleMock).toHaveBeenCalled());
    const [paymentId, spec] = createScheduleMock.mock.calls[0];
    expect(paymentId).toBe('new-1');
    expect(spec.everyMs).toBe(86_400_000); // default = every 1 day
    expect(createPaymentMock.mock.calls[0][0].type).toBe('RECURRING');
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('recurring create: schedule failure rolls back the payment via DELETE', async () => {
    createPaymentMock.mockResolvedValueOnce(makePayment({ id: 'new-2', type: 'RECURRING' }));
    const scheduleErr = Object.assign(new Error('Invalid cron expression.'), {
      errorCode: 'PAYMENT_SCHEDULE_INVALID_CRON',
    });
    createScheduleMock.mockRejectedValueOnce(scheduleErr);
    removePaymentMock.mockResolvedValueOnce({
      deletedAttributions: 1,
      addedAttributions: 0,
      paymentDeleted: true,
      payment: null,
    });
    const { onSaved, onClose } = renderCreate();
    fillBaseFields();
    pickRecurring();
    // Switch to cron mode + invalid string (server validates).
    fireEvent.click(screen.getByTestId('schedule-mode-cron'));
    fireEvent.change(screen.getByTestId('schedule-cron-input'), {
      target: { value: 'bogus expression text' },
    });
    fireEvent.click(screen.getByTestId('form-save'));
    await waitFor(() => expect(createScheduleMock).toHaveBeenCalled());
    await waitFor(() => expect(removePaymentMock).toHaveBeenCalledWith('new-2', 'all'));
    // Inline cron error surfaced; dialog stays open.
    await waitFor(() => expect(screen.getByTestId('schedule-error-cron')).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('recurring edit: PUT /schedule when spec changes', async () => {
    const payment = makePayment({ id: 'p-rec', type: 'RECURRING' });
    updatePaymentMock.mockResolvedValueOnce(payment);
    replaceScheduleMock.mockResolvedValueOnce({ id: 's-1' });
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <PaymentFormDialog
        open
        mode="edit"
        payment={payment}
        existingSchedule={{
          id: 's-1',
          paymentId: payment.id,
          cron: null,
          everyMs: 86_400_000,
          startsAt: '2026-04-25T00:00:00Z',
          endsAt: null,
          limit: null,
          nextRunAt: null,
          lastRunAt: null,
          pausedAt: null,
          cancelledAt: null,
          createdAt: '2026-04-25T00:00:00Z',
          updatedAt: '2026-04-25T00:00:00Z',
        }}
        onClose={onClose}
        onSaved={onSaved}
        categories={DEFAULT_CATS}
      />,
    );
    // Sub-form is auto-shown for RECURRING parent.
    expect(screen.getByTestId('payment-schedule-subform')).toBeInTheDocument();
    // Change the count from 1 → 5.
    fireEvent.change(screen.getByTestId('schedule-every-count'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('form-save'));
    await waitFor(() => expect(replaceScheduleMock).toHaveBeenCalled());
    const spec = replaceScheduleMock.mock.calls[0][1];
    expect(spec.everyMs).toBe(5 * 86_400_000);
  });

  it('recurring edit: changing type RECURRING → ONE_TIME shows the type-change warning', () => {
    const payment = makePayment({ type: 'RECURRING' });
    renderEdit(payment);
    // ONE_TIME radio is always visible up top — flip back to ONE_TIME.
    fireEvent.click(screen.getByTestId('type-radio-ONE_TIME'));
    expect(screen.getByTestId('schedule-type-change-warning')).toBeInTheDocument();
  });

  it('recurring create: validation aggregates payment + schedule errors', async () => {
    renderCreate();
    pickRecurring();
    // Skip filling amount → payment validation fails; clear startsAt to also
    // fail the schedule validation.
    fireEvent.change(screen.getByTestId('schedule-starts-at'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('form-save'));
    expect(await screen.findByTestId('form-error-amount')).toBeInTheDocument();
    expect(await screen.findByTestId('schedule-error-starts-at')).toBeInTheDocument();
    expect(createPaymentMock).not.toHaveBeenCalled();
  });

  it('recurring create: client-side everyMs<60_000 short-circuits the create', async () => {
    renderCreate();
    fillBaseFields();
    pickRecurring();
    // Clear the count → buildScheduleSpec rejects via "everyCountInvalid".
    fireEvent.change(screen.getByTestId('schedule-every-count'), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('form-save'));
    });
    expect(await screen.findByTestId('schedule-error-every')).toBeInTheDocument();
    expect(createPaymentMock).not.toHaveBeenCalled();
  });

  it('recurring create: type=ONE_TIME path stays unchanged (no schedule call)', async () => {
    createPaymentMock.mockResolvedValueOnce(makePayment());
    renderCreate();
    fillBaseFields();
    fireEvent.click(screen.getByTestId('form-save'));
    await waitFor(() => expect(createPaymentMock).toHaveBeenCalled());
    expect(createPaymentMock.mock.calls[0][0].type).toBe('ONE_TIME');
    expect(createScheduleMock).not.toHaveBeenCalled();
  });

  it('recurring: switching ONE_TIME → RECURRING → ONE_TIME hides sub-form (sticky state)', () => {
    renderCreate();
    pickRecurring();
    // Tweak a value in the every-path so we can verify it survives the toggle.
    fireEvent.change(screen.getByTestId('schedule-every-count'), { target: { value: '7' } });
    expect((screen.getByTestId('schedule-every-count') as HTMLInputElement).value).toBe('7');
    // Toggle off → sub-form hidden.
    fireEvent.click(screen.getByTestId('type-radio-ONE_TIME'));
    expect(screen.queryByTestId('payment-schedule-subform')).not.toBeInTheDocument();
    // Re-toggle on → sub-form re-shown with sticky 7.
    fireEvent.click(screen.getByTestId('type-radio-RECURRING'));
    expect(screen.getByTestId('payment-schedule-subform')).toBeInTheDocument();
    expect((screen.getByTestId('schedule-every-count') as HTMLInputElement).value).toBe('7');
  });
});
