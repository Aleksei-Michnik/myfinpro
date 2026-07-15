import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionPlanSection } from './TransactionPlanSection';
import type { PlanResponse } from '@/lib/transaction/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}(${Object.values(values).join(',')})` : key,
  useLocale: () => 'en',
}));

const getPlanMock = vi.fn();
const cancelPlanMock = vi.fn();
const addToastMock = vi.fn();

vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({ getPlan: getPlanMock, cancelPlan: cancelPlanMock }),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me' } }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePlan(over: Partial<PlanResponse> = {}): PlanResponse {
  return {
    id: 'plan-1',
    transactionId: 'pay-1',
    kind: 'INSTALLMENT',
    principalCents: 120_000,
    interestRate: 0,
    transactionsCount: 3,
    frequency: 'MONTHLY',
    firstDueAt: '2026-08-01T00:00:00.000Z',
    amortizationMethod: 'equal',
    cancelledAt: null,
    createdAt: '2026-07-04T00:00:00.000Z',
    rows: [1, 2, 3].map((index) => ({
      index,
      dueAt: `2026-0${7 + index}-01T00:00:00.000Z`,
      principalCents: 40_000,
      interestCents: 0,
      totalCents: 40_000,
      remainingCents: 120_000 - index * 40_000,
      occurrenceId: `occ-${index}`,
      status: 'PENDING',
    })),
    ...over,
  };
}

function renderSection(createdById = 'me') {
  return render(
    <TransactionPlanSection transactionId="pay-1" createdById={createdById} currency="USD" />,
  );
}

describe('TransactionPlanSection', () => {
  beforeEach(() => {
    getPlanMock.mockReset();
    cancelPlanMock.mockReset();
    addToastMock.mockReset();
  });

  it('fetches and renders the amortisation table with per-row statuses', async () => {
    getPlanMock.mockResolvedValueOnce(makePlan());
    renderSection();
    await waitFor(() => expect(screen.getByTestId('plan-section')).toBeInTheDocument());
    expect(getPlanMock).toHaveBeenCalledWith('pay-1', expect.anything());
    expect(screen.getByTestId('plan-status-pill').textContent).toBe('statusActive');
    expect(screen.getByTestId('plan-table')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^plan-row-\d+$/)).toHaveLength(3);
    expect(screen.getByTestId('plan-row-status-1').textContent).toBe('rowStatus.PENDING');
    // Money formatted in the transaction's currency.
    expect(screen.getByTestId('plan-row-1').textContent).toContain('$400.00');
  });

  it('renders nothing when the transaction has no plan (404 → null)', async () => {
    getPlanMock.mockResolvedValueOnce(null);
    const { container } = renderSection();
    await waitFor(() => expect(getPlanMock).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-testid="plan-section"]')).toBeNull());
    expect(container.querySelector('[data-testid="plan-section-loading"]')).toBeNull();
  });

  it('cancel is two-step and terminal: confirm calls cancelPlan and re-renders cancelled', async () => {
    getPlanMock.mockResolvedValueOnce(makePlan());
    cancelPlanMock.mockResolvedValueOnce(
      makePlan({
        cancelledAt: '2026-07-04T12:00:00.000Z',
        rows: makePlan().rows.map((r) => ({ ...r, status: 'CANCELLED' })),
      }),
    );
    renderSection();
    await waitFor(() => expect(screen.getByTestId('plan-actions')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('plan-action-cancel'));
    expect(cancelPlanMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('plan-cancel-confirm-yes'));
    await waitFor(() => expect(cancelPlanMock).toHaveBeenCalledWith('pay-1', expect.anything()));

    await waitFor(() =>
      expect(screen.getByTestId('plan-status-pill').textContent).toBe('statusCancelled'),
    );
    // Terminal → actions row gone; row statuses flipped.
    expect(screen.queryByTestId('plan-actions')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-row-status-1').textContent).toBe('rowStatus.CANCELLED');
    expect(addToastMock).toHaveBeenCalledWith('success', 'cancelledToast');
  });

  it('keep dismisses the confirm strip without cancelling', async () => {
    getPlanMock.mockResolvedValueOnce(makePlan());
    renderSection();
    await waitFor(() => expect(screen.getByTestId('plan-actions')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('plan-action-cancel'));
    fireEvent.click(screen.getByTestId('plan-cancel-confirm-keep'));
    expect(screen.queryByTestId('plan-cancel-confirm')).not.toBeInTheDocument();
    expect(cancelPlanMock).not.toHaveBeenCalled();
  });

  it('non-creators see no cancel action', async () => {
    getPlanMock.mockResolvedValueOnce(makePlan());
    renderSection('someone-else');
    await waitFor(() => expect(screen.getByTestId('plan-section')).toBeInTheDocument());
    expect(screen.queryByTestId('plan-actions')).not.toBeInTheDocument();
  });

  it('a failed cancel surfaces an error toast and keeps the plan active', async () => {
    getPlanMock.mockResolvedValueOnce(makePlan());
    cancelPlanMock.mockRejectedValueOnce(new Error('conflict'));
    renderSection();
    await waitFor(() => expect(screen.getByTestId('plan-actions')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('plan-action-cancel'));
    fireEvent.click(screen.getByTestId('plan-cancel-confirm-yes'));
    await waitFor(() => expect(addToastMock).toHaveBeenCalledWith('error', expect.any(String)));
    expect(screen.getByTestId('plan-status-pill').textContent).toBe('statusActive');
  });

  it('fetch failure renders the inline error with retry', async () => {
    getPlanMock.mockRejectedValueOnce(new Error('boom'));
    getPlanMock.mockResolvedValueOnce(makePlan());
    renderSection();
    await waitFor(() => expect(screen.getByTestId('plan-section-error')).toBeInTheDocument());
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByTestId('plan-section')).toBeInTheDocument());
  });
});
