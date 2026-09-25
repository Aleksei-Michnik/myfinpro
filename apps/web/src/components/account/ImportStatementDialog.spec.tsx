import { describe, expect, it, vi } from 'vitest';
import { guessHeaderRow, sumImports } from './ImportStatementDialog';
import type { AccountImport } from '@/lib/account/types';

vi.mock('@/i18n/navigation', () => ({ Link: () => null }));

describe('sumImports', () => {
  it('adds the chunks up', () => {
    const chunk = (n: number): AccountImport =>
      ({
        insertedCount: n,
        duplicateCount: 1,
        suggestedMatchCount: 2,
        suggestedTransferCount: 0,
        needsInputCount: 3,
      }) as AccountImport;
    expect(sumImports([chunk(5), chunk(7)])).toEqual({
      inserted: 12,
      duplicates: 2,
      matches: 4,
      transfers: 0,
      needsInput: 6,
    });
    expect(sumImports([]).inserted).toBe(0);
  });
});

describe('guessHeaderRow', () => {
  it('skips title rows with fewer than three cells', () => {
    expect(
      guessHeaderRow([
        ['Bank statement'],
        ['Account', '1234'],
        ['Date', 'Desc', 'Amount'],
        ['1', '2', '3'],
      ]),
    ).toBe(2);
    expect(guessHeaderRow([['a', 'b']])).toBe(0);
  });
});

vi.mock('next-intl', async () => (await import('@/test-utils/real-messages')).realMessagesIntl());
vi.mock('@/lib/group/group-context', () => ({ useGroups: () => ({ groups: [] }) }));
vi.mock('@/lib/account/account-context', () => ({
  useAccounts: () => ({ createImport: vi.fn(), applySuggestions: vi.fn(), getAccount: vi.fn() }),
  useOptionalAccounts: () => null,
}));

describe('ImportStatementDialog', () => {
  it('renders step 1 with a locked account and every label resolved from the bundle', async () => {
    const { render, screen } = await import('@testing-library/react');
    const { ImportStatementDialog } = await import('./ImportStatementDialog');
    const account = { id: 'acc', name: 'Checking', currency: 'ILS' } as never;
    render(
      <ImportStatementDialog
        open
        account={account}
        onClose={() => undefined}
        onImported={() => undefined}
      />,
    );
    const dialog = screen.getByTestId('statement-import-dialog');
    expect(dialog).toHaveTextContent('Import statement');
    expect(screen.getByTestId('statement-import-step-1')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('statement-import-account')).toBeDisabled();
    expect(screen.getByTestId('statement-dropzone')).toHaveTextContent('Drop your statement here');
    expect(screen.queryByTestId('statement-camera-button')).toBeNull();
    expect(screen.getByTestId('statement-import-continue')).toBeDisabled();
    expect(dialog.textContent).not.toMatch(/accounts\.[a-zA-Z]+\./);
  });
});
