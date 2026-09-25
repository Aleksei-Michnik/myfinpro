import { describe, expect, it } from 'vitest';
import { displayLedgerCents, isCardOwed, isReconciled } from '../formatters';

describe('account formatters', () => {
  it('treats a negative card balance as owed, never a negative bank balance', () => {
    expect(isCardOwed({ kind: 'CARD', ledgerBalanceCents: -1 })).toBe(true);
    expect(isCardOwed({ kind: 'CARD', ledgerBalanceCents: 0 })).toBe(false);
    expect(isCardOwed({ kind: 'BANK', ledgerBalanceCents: -1 })).toBe(false);
  });

  it('renders the owed amount as its absolute value', () => {
    expect(displayLedgerCents({ kind: 'CARD', ledgerBalanceCents: -4200 })).toBe(4200);
    expect(displayLedgerCents({ kind: 'BANK', ledgerBalanceCents: -4200 })).toBe(-4200);
    expect(displayLedgerCents({ kind: 'CASH', ledgerBalanceCents: 10 })).toBe(10);
  });

  it('is reconciled only when a reported balance exists and the gap is zero', () => {
    expect(isReconciled(0)).toBe(true);
    expect(isReconciled(1)).toBe(false);
    expect(isReconciled(null)).toBe(false);
    expect(isReconciled(undefined)).toBe(false);
  });
});
