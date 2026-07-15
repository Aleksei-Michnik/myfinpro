import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  buildPlanSpec,
  defaultPlanSubFormState,
  TransactionPlanSubForm,
  type PlanSubFormState,
} from './TransactionPlanSubForm';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const tId = (key: string) => key;

function s(over: Partial<PlanSubFormState> = {}): PlanSubFormState {
  return { ...defaultPlanSubFormState(), firstDueAt: '2026-08-01', ...over };
}

describe('buildPlanSpec', () => {
  it('builds a valid INSTALLMENT spec (auto method omitted from the wire shape)', () => {
    const r = buildPlanSpec(
      s({ interestRatePctStr: '0', transactionsCountStr: '12' }),
      'INSTALLMENT',
      tId,
    );
    expect(r.ok).toBe(true);
    expect(r.spec).toEqual({
      interestRate: 0,
      transactionsCount: 12,
      frequency: 'MONTHLY',
      firstDueAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('converts percent input to a decimal fraction', () => {
    const r = buildPlanSpec(
      s({ interestRatePctStr: '5', transactionsCountStr: '60' }),
      'LOAN',
      tId,
    );
    expect(r.ok).toBe(true);
    expect(r.spec.interestRate).toBeCloseTo(0.05);
  });

  it('includes an explicit method override', () => {
    const r = buildPlanSpec(s({ method: 'french' }), 'INSTALLMENT', tId);
    expect(r.ok).toBe(true);
    expect(r.spec.amortizationMethod).toBe('french');
  });

  it('rejects a non-zero rate for the equal method (explicit or INSTALLMENT default)', () => {
    const viaDefault = buildPlanSpec(s({ interestRatePctStr: '5' }), 'INSTALLMENT', tId);
    expect(viaDefault.ok).toBe(false);
    expect(viaDefault.errors.interestRate).toBe('equalRequiresZeroRate');

    const explicit = buildPlanSpec(s({ interestRatePctStr: '5', method: 'equal' }), 'LOAN', tId);
    expect(explicit.ok).toBe(false);
    expect(explicit.errors.interestRate).toBe('equalRequiresZeroRate');

    // LOAN default is french — 5% is fine there.
    const loan = buildPlanSpec(s({ interestRatePctStr: '5' }), 'LOAN', tId);
    expect(loan.ok).toBe(true);
  });

  it.each([
    ['empty rate', { interestRatePctStr: '' }, 'interestRate', 'rateInvalid'],
    ['negative rate', { interestRatePctStr: '-1' }, 'interestRate', 'rateInvalid'],
    ['rate above 100%', { interestRatePctStr: '150' }, 'interestRate', 'rateTooHigh'],
    ['zero count', { transactionsCountStr: '0' }, 'transactionsCount', 'countInvalid'],
    ['fractional count', { transactionsCountStr: '2.5' }, 'transactionsCount', 'countInvalid'],
    ['count above 600', { transactionsCountStr: '601' }, 'transactionsCount', 'countTooHigh'],
    ['missing first due', { firstDueAt: '' }, 'firstDueAt', 'firstDueRequired'],
  ] as const)('rejects %s', (_label, patch, field, code) => {
    const r = buildPlanSpec(s(patch), 'INSTALLMENT', tId);
    expect(r.ok).toBe(false);
    expect(r.errors[field]).toBe(code);
  });
});

describe('TransactionPlanSubForm', () => {
  it('renders all fields and propagates changes', () => {
    const onChange = vi.fn();
    render(<TransactionPlanSubForm state={s()} errors={{}} onChange={onChange} />);
    expect(screen.getByTestId('transaction-plan-subform')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('plan-count'), { target: { value: '24' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ transactionsCountStr: '24' }));
    fireEvent.change(screen.getByTestId('plan-frequency'), { target: { value: 'WEEKLY' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ frequency: 'WEEKLY' }));
  });

  it('renders inline errors', () => {
    render(
      <TransactionPlanSubForm
        state={s()}
        errors={{ interestRate: 'rateInvalid', transactionsCount: 'countInvalid' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('plan-error-rate').textContent).toBe('rateInvalid');
    expect(screen.getByTestId('plan-error-count').textContent).toBe('countInvalid');
  });

  it('disables every input when disabled', () => {
    render(<TransactionPlanSubForm state={s()} errors={{}} onChange={vi.fn()} disabled />);
    for (const id of [
      'plan-rate',
      'plan-count',
      'plan-frequency',
      'plan-first-due',
      'plan-method',
    ]) {
      expect((screen.getByTestId(id) as HTMLInputElement).disabled).toBe(true);
    }
  });
});
