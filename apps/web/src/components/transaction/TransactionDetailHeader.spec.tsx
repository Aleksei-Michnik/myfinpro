import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentDetailHeader } from './PaymentDetailHeader';
import type { PaymentSummary } from '@/lib/payment/types';

const mockToggleStar = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values && 'count' in values ? `${key}:${values.count}` : key,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me' } }),
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
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        memberCount: 2,
      },
    ],
  }),
}));

vi.mock('@/lib/payment/payment-context', () => ({
  usePayments: () => ({ toggleStar: mockToggleStar }),
}));

function makePayment(p: Partial<PaymentSummary> = {}): PaymentSummary {
  return {
    id: 'p-1',
    direction: 'OUT',
    type: 'ONE_TIME',
    amountCents: 1234,
    currency: 'USD',
    occurredAt: '2026-04-25T00:00:00Z',
    status: 'POSTED',
    category: { id: 'c-1', slug: 'misc', name: 'Misc', icon: null, color: null },
    attributions: [{ scope: 'personal', userId: 'me', groupId: null, groupName: null }],
    note: null,
    commentCount: 0,
    starredByMe: false,
    hasDocuments: false,
    parentPaymentId: null,
    createdById: 'me',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
    ...p,
  };
}

describe('PaymentDetailHeader', () => {
  beforeEach(() => {
    mockToggleStar.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const noop = () => {};

  it('IN direction badge uses the green class', () => {
    render(
      <PaymentDetailHeader
        payment={makePayment({ direction: 'IN' })}
        onEditClick={noop}
        onDeleteClick={noop}
      />,
    );
    expect(screen.getByTestId('detail-direction').className).toMatch(/green/);
  });

  it('OUT direction badge uses the red class', () => {
    render(
      <PaymentDetailHeader
        payment={makePayment({ direction: 'OUT' })}
        onEditClick={noop}
        onDeleteClick={noop}
      />,
    );
    expect(screen.getByTestId('detail-direction').className).toMatch(/red/);
  });

  it('amount uses formatSignedAmount (sign + currency)', () => {
    render(<PaymentDetailHeader payment={makePayment()} onEditClick={noop} onDeleteClick={noop} />);
    expect(screen.getByTestId('detail-amount').textContent).toMatch(/^-/);
    expect(screen.getByTestId('detail-amount').textContent).toMatch(/12\.34/);
  });

  it('no-note placeholder is shown when note is empty', () => {
    render(<PaymentDetailHeader payment={makePayment()} onEditClick={noop} onDeleteClick={noop} />);
    expect(screen.getByTestId('detail-no-note')).toBeInTheDocument();
  });

  it('blockquote renders when note is present', () => {
    render(
      <PaymentDetailHeader
        payment={makePayment({ note: 'weekly shopping' })}
        onEditClick={noop}
        onDeleteClick={noop}
      />,
    );
    expect(screen.getByTestId('detail-note')).toHaveTextContent('weekly shopping');
  });

  it('edit button enabled for creator of a ONE_TIME non-occurrence payment', () => {
    render(<PaymentDetailHeader payment={makePayment()} onEditClick={noop} onDeleteClick={noop} />);
    expect(screen.getByTestId('detail-edit')).not.toBeDisabled();
  });

  it('edit button disabled for non-creator with tooltip explaining why', () => {
    render(
      <PaymentDetailHeader
        payment={makePayment({ createdById: 'someone-else' })}
        onEditClick={noop}
        onDeleteClick={noop}
      />,
    );
    const btn = screen.getByTestId('detail-edit');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/editDisabledNotCreator/);
  });

  it('edit button disabled for generated occurrences (child) with the right tooltip', () => {
    render(
      <PaymentDetailHeader
        payment={makePayment({ parentPaymentId: 'parent-1' })}
        onEditClick={noop}
        onDeleteClick={noop}
      />,
    );
    const btn = screen.getByTestId('detail-edit');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.getAttribute('title')).toMatch(/editDisabled\.generatedOccurrence/);
  });

  // Phase 6 · Iteration 6.18.1.2 — RECURRING parents are now editable
  // (the form ships the schedule sub-form). Regression for the lifted
  // 6.13 ONE_TIME-only guard.
  it('edit button enabled for RECURRING parent (parentPaymentId === null)', () => {
    render(
      <PaymentDetailHeader
        payment={makePayment({ type: 'RECURRING' })}
        onEditClick={noop}
        onDeleteClick={noop}
      />,
    );
    expect(screen.getByTestId('detail-edit')).not.toBeDisabled();
  });

  it('edit button disabled for unsupported types (INSTALLMENT) with the right tooltip', () => {
    render(
      <PaymentDetailHeader
        payment={makePayment({ type: 'INSTALLMENT' })}
        onEditClick={noop}
        onDeleteClick={noop}
      />,
    );
    const btn = screen.getByTestId('detail-edit');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/editDisabled\.unsupportedType/);
  });

  it('delete button visible and enabled regardless of creator', () => {
    render(
      <PaymentDetailHeader
        payment={makePayment({ createdById: 'someone-else' })}
        onEditClick={noop}
        onDeleteClick={noop}
      />,
    );
    expect(screen.getByTestId('detail-delete')).toBeInTheDocument();
    expect(screen.getByTestId('detail-delete')).not.toBeDisabled();
  });

  // Delete follows the same form-eligibility rule (no schedule cascade
  // for unsupported types). Creator is NOT required (a non-creator can
  // still detach their own attribution via the dialog).
  it('delete button disabled for child occurrences with tooltip', () => {
    render(
      <PaymentDetailHeader
        payment={makePayment({ parentPaymentId: 'parent-1' })}
        onEditClick={noop}
        onDeleteClick={noop}
      />,
    );
    const btn = screen.getByTestId('detail-delete');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toMatch(/editDisabled\.generatedOccurrence/);
  });

  it('delete button enabled for RECURRING parent', () => {
    render(
      <PaymentDetailHeader
        payment={makePayment({ type: 'RECURRING' })}
        onEditClick={noop}
        onDeleteClick={noop}
      />,
    );
    expect(screen.getByTestId('detail-delete')).not.toBeDisabled();
  });

  // Phase 6 · Iteration 6.16.5 — regression: the Delete button must use the
  // canonical solid `danger` variant (white text on red), NOT the previous
  // low-contrast tinted treatment that left the button looking disabled when
  // idle. Also: the button must NOT be disabled when the page is idle —
  // any disabled-state bleed-through from an unrelated async op is forbidden.
  it('delete button uses solid danger variant (WCAG-AA contrast) and is enabled when idle', () => {
    render(<PaymentDetailHeader payment={makePayment()} onEditClick={noop} onDeleteClick={noop} />);
    const btn = screen.getByTestId('detail-delete');
    // Solid red background + white foreground → matches `<Button variant="danger">`.
    expect(btn.className).toContain('bg-red-600');
    expect(btn.className).toContain('text-white');
    // No low-contrast tint.
    expect(btn.className).not.toMatch(/text-red-300/);
    expect(btn.className).not.toMatch(/text-red-700/);
    // No disabled bleed-through.
    expect(btn).not.toBeDisabled();
    expect(btn.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('star toggle optimistic flip + bubble onStarToggled', async () => {
    mockToggleStar.mockResolvedValueOnce({ starred: true, starCount: 1 });
    const onStar = vi.fn();
    render(
      <PaymentDetailHeader
        payment={makePayment()}
        onEditClick={noop}
        onDeleteClick={noop}
        onStarToggled={onStar}
      />,
    );
    const btn = screen.getByTestId('detail-star');
    fireEvent.click(btn);
    await waitFor(() => expect(onStar).toHaveBeenCalledWith(true));
    // After settle, the button shows the filled glyph (no spinner).
    expect(btn.textContent).toMatch(/★/);
    expect(mockToggleStar).toHaveBeenCalledWith('p-1', expect.any(AbortSignal));
  });

  it('star toggle reverts on error', async () => {
    mockToggleStar.mockRejectedValueOnce(new Error('boom'));
    render(<PaymentDetailHeader payment={makePayment()} onEditClick={noop} onDeleteClick={noop} />);
    const btn = screen.getByTestId('detail-star');
    fireEvent.click(btn);
    await waitFor(() => expect(btn.textContent).toMatch(/☆/));
  });

  it('group attribution renders as a link to /groups/:id when user is a member', () => {
    render(
      <PaymentDetailHeader
        payment={makePayment({
          attributions: [
            {
              scope: 'group',
              userId: null,
              groupId: 'g-1',
              groupName: 'Family',
            },
          ],
        })}
        onEditClick={noop}
        onDeleteClick={noop}
      />,
    );
    const link = screen.getByTestId('detail-attribution-link-g-1');
    expect(link.getAttribute('href')).toBe('/groups/g-1');
  });
});
