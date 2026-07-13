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
const getPaymentMock = vi.fn();
const editPaymentWithPropagationMock = vi.fn();
const listOccurrencesMock = vi.fn();
const addToastMock = vi.fn();

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

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
    getPayment: getPaymentMock,
    editPaymentWithPropagation: editPaymentWithPropagationMock,
    listOccurrences: listOccurrencesMock,
  }),
}));

// Phase 7.13 — receipt intake from the create dialog; 8.13 adds the URL path.
const uploadReceiptMock = vi.fn();
const createFromUrlMock = vi.fn();
vi.mock('@/lib/receipt/receipt-context', () => ({
  useReceipts: () => ({ uploadReceipt: uploadReceiptMock, createFromUrl: createFromUrlMock }),
}));

const routerPushMock = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
  usePathname: () => '/',
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
    getPaymentMock.mockReset();
    // Default: synchronous throw mirrors the previous "not implemented"
    // behaviour and keeps tests that don't care about the refetch
    // straightforward — the dialog falls back to the prop instantly.
    // Tests that exercise the refetch path override this.
    getPaymentMock.mockImplementation(() => {
      throw new Error('not configured');
    });
    editPaymentWithPropagationMock.mockReset();
    listOccurrencesMock.mockReset();
    addToastMock.mockReset();
    uploadReceiptMock.mockReset();
    createFromUrlMock.mockReset();
    routerPushMock.mockReset();
    // Default: no children → edits of RECURRING parents submit directly.
    // Propagation tests override with a non-empty page.
    listOccurrencesMock.mockResolvedValue({ data: [], cursor: null, hasMore: false });
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

  // ── From receipt (7.13) ────────────────────────────────────────────────────

  it('create: picking a receipt file uploads it, routes to review, and closes', async () => {
    uploadReceiptMock.mockResolvedValue({ id: 'r-77' });
    const { onClose } = renderCreate();

    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('payment-form-receipt-input'), {
      target: { files: [file] },
    });

    await waitFor(() => expect(uploadReceiptMock).toHaveBeenCalledWith(file, expect.anything()));
    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith('/receipts/r-77'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('create: a failed receipt upload toasts and keeps the dialog open', async () => {
    uploadReceiptMock.mockRejectedValue(new Error('Unsupported file type'));
    const { onClose } = renderCreate();

    fireEvent.change(screen.getByTestId('payment-form-receipt-input'), {
      target: { files: [new File(['x'], 'x.gif', { type: 'image/gif' })] },
    });

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('Unsupported')),
    );
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── From receipt via URL (8.13) ────────────────────────────────────────────

  it('create: the URL row is hidden until the toggle opens it', () => {
    renderCreate();

    expect(screen.queryByTestId('payment-form-receipt-url-input')).toBeNull();
    const toggle = screen.getByTestId('payment-form-receipt-url-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('payment-form-receipt-url-input')).toBeTruthy();
  });

  it('create: submitting a receipt URL creates it, routes to review, and closes', async () => {
    createFromUrlMock.mockResolvedValue({ id: 'r-88' });
    const { onClose } = renderCreate();

    fireEvent.click(screen.getByTestId('payment-form-receipt-url-toggle'));
    fireEvent.change(screen.getByTestId('payment-form-receipt-url-input'), {
      target: { value: '  https://shop.example/e-receipt/42  ' },
    });
    fireEvent.click(screen.getByTestId('payment-form-receipt-url-submit'));

    await waitFor(() =>
      expect(createFromUrlMock).toHaveBeenCalledWith(
        'https://shop.example/e-receipt/42',
        expect.anything(),
      ),
    );
    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith('/receipts/r-88'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('create: Enter in the URL field adds the receipt without submitting the payment form', async () => {
    createFromUrlMock.mockResolvedValue({ id: 'r-88' });
    renderCreate();

    fireEvent.click(screen.getByTestId('payment-form-receipt-url-toggle'));
    const input = screen.getByTestId('payment-form-receipt-url-input');
    fireEvent.change(input, { target: { value: 'https://shop.example/e-receipt/42' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(createFromUrlMock).toHaveBeenCalled());
    expect(createPaymentMock).not.toHaveBeenCalled();
  });

  it('create: a failed URL receipt toasts and keeps the dialog open', async () => {
    createFromUrlMock.mockRejectedValue(new Error('Only http(s) URLs are supported'));
    const { onClose } = renderCreate();

    fireEvent.click(screen.getByTestId('payment-form-receipt-url-toggle'));
    fireEvent.change(screen.getByTestId('payment-form-receipt-url-input'), {
      target: { value: 'ftp://nope' },
    });
    fireEvent.click(screen.getByTestId('payment-form-receipt-url-submit'));

    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith('error', expect.stringContaining('http(s)')),
    );
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('edit: the from-receipt intake is not offered', () => {
    renderEdit(makePayment());
    expect(screen.queryByTestId('payment-form-from-receipt')).toBeNull();
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

  // ── Phase 6 · 6.20 — plan kinds (INSTALLMENT / LOAN / MORTGAGE) ───────────

  describe('plans (6.20)', () => {
    function pickPlanKind(kind: 'INSTALLMENT' | 'LOAN' | 'MORTGAGE') {
      fireEvent.click(screen.getByTestId('type-disclosure-toggle'));
      fireEvent.click(screen.getByTestId(`type-radio-${kind}`));
    }

    it('create: picking a plan kind reveals the plan sub-form', () => {
      renderCreate();
      pickPlanKind('INSTALLMENT');
      expect(screen.getByTestId('payment-plan-subform')).toBeInTheDocument();
      // Mutually exclusive with the schedule sub-form.
      expect(screen.queryByTestId('payment-schedule-subform')).not.toBeInTheDocument();
    });

    it('create: LOAN posts type + plan body with percent converted to a fraction', async () => {
      createPaymentMock.mockResolvedValueOnce(makePayment({ id: 'loan-1', type: 'LOAN' }));
      const { onSaved } = renderCreate();
      fillBaseFields();
      pickPlanKind('LOAN');
      fireEvent.change(screen.getByTestId('plan-rate'), { target: { value: '5' } });
      fireEvent.change(screen.getByTestId('plan-count'), { target: { value: '60' } });
      fireEvent.change(screen.getByTestId('plan-first-due'), { target: { value: '2026-08-01' } });
      fireEvent.click(screen.getByTestId('form-save'));
      await waitFor(() => expect(createPaymentMock).toHaveBeenCalled());
      const payload = createPaymentMock.mock.calls[0][0];
      expect(payload.type).toBe('LOAN');
      expect(payload.plan).toEqual({
        interestRate: 0.05,
        paymentsCount: 60,
        frequency: 'MONTHLY',
        firstDueAt: '2026-08-01T00:00:00.000Z',
      });
      // Single-step create: no schedule call for plan kinds.
      expect(createScheduleMock).not.toHaveBeenCalled();
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
    });

    it('create: invalid plan (INSTALLMENT with non-zero rate) short-circuits the save', async () => {
      renderCreate();
      fillBaseFields();
      pickPlanKind('INSTALLMENT');
      fireEvent.change(screen.getByTestId('plan-rate'), { target: { value: '5' } });
      await act(async () => {
        fireEvent.click(screen.getByTestId('form-save'));
      });
      expect(await screen.findByTestId('plan-error-rate')).toBeInTheDocument();
      expect(createPaymentMock).not.toHaveBeenCalled();
    });

    it('create: explicit method override is included in the payload', async () => {
      createPaymentMock.mockResolvedValueOnce(makePayment({ id: 'inst-1', type: 'INSTALLMENT' }));
      renderCreate();
      fillBaseFields();
      pickPlanKind('INSTALLMENT');
      fireEvent.change(screen.getByTestId('plan-method'), { target: { value: 'french' } });
      fireEvent.change(screen.getByTestId('plan-rate'), { target: { value: '3' } });
      fireEvent.change(screen.getByTestId('plan-first-due'), { target: { value: '2026-08-01' } });
      fireEvent.click(screen.getByTestId('form-save'));
      await waitFor(() => expect(createPaymentMock).toHaveBeenCalled());
      expect(createPaymentMock.mock.calls[0][0].plan.amortizationMethod).toBe('french');
    });

    it('edit: plan kinds stay disabled (create-only)', () => {
      renderEdit(makePayment({ type: 'ONE_TIME' }));
      fireEvent.click(screen.getByTestId('type-disclosure-toggle'));
      const radio = screen.getByTestId('type-radio-INSTALLMENT') as HTMLInputElement;
      expect(radio.disabled).toBe(true);
      expect(screen.getByTestId('type-badge-INSTALLMENT')).toBeInTheDocument();
    });
  });

  // ── Phase 6 · 6.18.1.5 — cascade edit with propagation choice ─────────────

  describe('propagation (6.18.1.5)', () => {
    const SCHEDULE_FIXTURE = {
      id: 's-1',
      paymentId: 'p-rec',
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
    };

    function renderRecurringEdit(payment: PaymentSummary) {
      const onClose = vi.fn();
      const onSaved = vi.fn();
      render(
        <PaymentFormDialog
          open
          mode="edit"
          payment={payment}
          existingSchedule={{ ...SCHEDULE_FIXTURE, paymentId: payment.id }}
          onClose={onClose}
          onSaved={onSaved}
          categories={DEFAULT_CATS}
        />,
      );
      return { onClose, onSaved };
    }

    /** Render a RECURRING parent that HAS children and wait for the probe. */
    async function renderParentWithChildren() {
      listOccurrencesMock.mockResolvedValue({
        data: [{ id: 'occ-1' }],
        cursor: null,
        hasMore: false,
      });
      const payment = makePayment({ id: 'p-rec', type: 'RECURRING' });
      const handlers = renderRecurringEdit(payment);
      await waitFor(() => expect(listOccurrencesMock).toHaveBeenCalledWith('p-rec', { limit: 1 }));
      // Flush the probe's .then() so hasChildren lands before we save.
      await act(async () => {});
      return { payment, ...handlers };
    }

    it('editing a cascadeable field on a parent with children opens the choice dialog', async () => {
      await renderParentWithChildren();
      fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '99.00' } });
      fireEvent.click(screen.getByTestId('form-save'));
      expect(await screen.findByTestId('propagation-choice-dialog')).toBeInTheDocument();
      // Deferred submit: nothing hits the API until a mode is confirmed.
      expect(updatePaymentMock).not.toHaveBeenCalled();
      expect(editPaymentWithPropagationMock).not.toHaveBeenCalled();
    });

    it('confirming a mode submits the stashed diff with that propagate value', async () => {
      const { payment, onSaved, onClose } = await renderParentWithChildren();
      editPaymentWithPropagationMock.mockResolvedValueOnce({
        payment,
        affectedChildrenCount: 3,
        skippedChildrenCount: 0,
      });
      replaceScheduleMock.mockResolvedValueOnce({ id: 's-1' });
      fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '99.00' } });
      fireEvent.click(screen.getByTestId('form-save'));
      await screen.findByTestId('propagation-choice-dialog');
      fireEvent.click(screen.getByTestId('propagation-mode-future'));
      fireEvent.click(screen.getByTestId('propagation-confirm'));
      await waitFor(() => expect(editPaymentWithPropagationMock).toHaveBeenCalled());
      const [id, diff, propagate, signal] = editPaymentWithPropagationMock.mock.calls[0];
      expect(id).toBe('p-rec');
      expect(diff.amountCents).toBe(9900);
      expect(propagate).toBe('future');
      expect(signal).toBeInstanceOf(AbortSignal);
      // Plain PATCH path must not fire — the cascade endpoint owns the edit.
      expect(updatePaymentMock).not.toHaveBeenCalled();
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith(payment));
      expect(onClose).toHaveBeenCalled();
      expect(addToastMock).toHaveBeenCalledWith('success', 'resultUpdated:3');
    });

    it('skipped children surface a second info toast', async () => {
      const { payment } = await renderParentWithChildren();
      editPaymentWithPropagationMock.mockResolvedValueOnce({
        payment,
        affectedChildrenCount: 2,
        skippedChildrenCount: 1,
      });
      replaceScheduleMock.mockResolvedValueOnce({ id: 's-1' });
      fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '50.00' } });
      fireEvent.click(screen.getByTestId('form-save'));
      await screen.findByTestId('propagation-choice-dialog');
      fireEvent.click(screen.getByTestId('propagation-confirm'));
      await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('success', 'resultUpdated:2'));
      expect(addToastMock).toHaveBeenCalledWith('info', 'resultSkipped:1');
    });

    it('cancelling the choice dialog returns to the form without submitting', async () => {
      const { onClose } = await renderParentWithChildren();
      fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '99.00' } });
      fireEvent.click(screen.getByTestId('form-save'));
      await screen.findByTestId('propagation-choice-dialog');
      fireEvent.click(screen.getByTestId('propagation-cancel'));
      await waitFor(() =>
        expect(screen.queryByTestId('propagation-choice-dialog')).not.toBeInTheDocument(),
      );
      expect(editPaymentWithPropagationMock).not.toHaveBeenCalled();
      expect(updatePaymentMock).not.toHaveBeenCalled();
      // Form stays open with the user's edits intact.
      expect(onClose).not.toHaveBeenCalled();
      expect((screen.getByTestId('form-amount') as HTMLInputElement).value).toBe('99.00');
    });

    it('occurredAt-only change is not cascadeable → direct PATCH, no dialog', async () => {
      const { payment } = await renderParentWithChildren();
      updatePaymentMock.mockResolvedValueOnce(payment);
      replaceScheduleMock.mockResolvedValueOnce({ id: 's-1' });
      fireEvent.change(screen.getByTestId('form-date'), { target: { value: '2026-04-26T00:00' } });
      fireEvent.click(screen.getByTestId('form-save'));
      await waitFor(() => expect(updatePaymentMock).toHaveBeenCalled());
      expect(screen.queryByTestId('propagation-choice-dialog')).not.toBeInTheDocument();
      expect(editPaymentWithPropagationMock).not.toHaveBeenCalled();
    });

    it('parent without children saves directly (no dialog)', async () => {
      // beforeEach default: listOccurrences resolves an empty page.
      const payment = makePayment({ id: 'p-rec', type: 'RECURRING' });
      updatePaymentMock.mockResolvedValueOnce(payment);
      replaceScheduleMock.mockResolvedValueOnce({ id: 's-1' });
      renderRecurringEdit(payment);
      await waitFor(() => expect(listOccurrencesMock).toHaveBeenCalled());
      await act(async () => {});
      fireEvent.change(screen.getByTestId('form-amount'), { target: { value: '99.00' } });
      fireEvent.click(screen.getByTestId('form-save'));
      await waitFor(() => expect(updatePaymentMock).toHaveBeenCalled());
      expect(screen.queryByTestId('propagation-choice-dialog')).not.toBeInTheDocument();
    });

    it('ONE_TIME payments never probe for children', async () => {
      renderEdit(makePayment({ id: 'p-1', type: 'ONE_TIME' }));
      await act(async () => {});
      expect(listOccurrencesMock).not.toHaveBeenCalled();
    });
  });

  // ── Phase 6 · 6.18.1.4-hotfix — edit-mode refetch ─────────────────────────
  // The dialog must request a fresh copy of the payment when it opens
  // in edit mode so users don't see (and submit) values that have gone
  // stale in another tab/device.

  describe('edit refetch', () => {
    it('calls getPayment with the prop id when opening in edit mode', () => {
      getPaymentMock.mockResolvedValueOnce(makePayment({ id: 'p-1', note: 'fresh' }));
      renderEdit(makePayment({ id: 'p-1', note: 'stale' }));
      expect(getPaymentMock).toHaveBeenCalledTimes(1);
      expect(getPaymentMock.mock.calls[0][0]).toBe('p-1');
      // Second arg is an AbortSignal so the dialog can cancel mid-flight.
      const signal = getPaymentMock.mock.calls[0][1];
      expect(signal).toBeInstanceOf(AbortSignal);
    });

    it('does NOT call getPayment in create mode', () => {
      renderCreate();
      expect(getPaymentMock).not.toHaveBeenCalled();
    });

    it('shows a loading state while the refetch is in flight', () => {
      // Resolve never — the loading banner stays visible.
      getPaymentMock.mockReturnValueOnce(new Promise(() => {}));
      renderEdit(makePayment({ id: 'p-1' }));
      expect(screen.getByTestId('payment-form-loading')).toBeInTheDocument();
    });

    it('repopulates the form with the freshly fetched payment data', async () => {
      // Server has a different note than the prop → form should show the
      // server value, not the stale prop.
      getPaymentMock.mockResolvedValueOnce(makePayment({ id: 'p-1', note: 'fresh-from-server' }));
      renderEdit(makePayment({ id: 'p-1', note: 'stale-prop' }));
      await waitFor(() => {
        expect((screen.getByTestId('form-note') as HTMLTextAreaElement).value).toBe(
          'fresh-from-server',
        );
      });
    });

    it('falls back to the prop and surfaces a soft warning when the refetch fails', async () => {
      getPaymentMock.mockRejectedValueOnce(new Error('boom'));
      renderEdit(makePayment({ id: 'p-1', note: 'prop-note' }));
      await waitFor(() => {
        expect(screen.getByTestId('payment-form-load-error')).toBeInTheDocument();
      });
      // Prop value still drives the form so the user can keep editing.
      expect((screen.getByTestId('form-note') as HTMLTextAreaElement).value).toBe('prop-note');
    });

    it('aborts the in-flight fetch when the dialog is closed', () => {
      let capturedSignal: AbortSignal | undefined;
      getPaymentMock.mockImplementationOnce((_id: string, signal?: AbortSignal) => {
        capturedSignal = signal;
        return new Promise(() => {});
      });
      const { rerender } = render(
        <PaymentFormDialog
          open
          mode="edit"
          payment={makePayment({ id: 'p-1' })}
          categories={DEFAULT_CATS}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      );
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(false);
      rerender(
        <PaymentFormDialog
          open={false}
          mode="edit"
          payment={makePayment({ id: 'p-1' })}
          categories={DEFAULT_CATS}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      );
      expect(capturedSignal!.aborted).toBe(true);
    });
  });
});
