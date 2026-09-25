import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountFormDialog } from './AccountFormDialog';

// Real English messages: a key the bundle lacks renders as its literal path.
vi.mock('next-intl', async () => (await import('@/test-utils/real-messages')).realMessagesIntl());
vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', defaultCurrency: 'ILS' } }),
}));
vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({ groups: [] }),
}));
vi.mock('@/lib/account/account-context', () => ({
  useAccounts: () => ({ createAccount: vi.fn(), updateAccount: vi.fn() }),
  useOptionalAccounts: () => null,
}));

const noop = () => undefined;

describe('AccountFormDialog', () => {
  it('renders the create form with every label resolved from the messages bundle', () => {
    render(<AccountFormDialog open mode="create" onClose={noop} onSaved={noop} />);
    const dialog = screen.getByTestId('account-form-dialog');
    expect(dialog).toHaveTextContent('New account');
    const kind = screen.getByTestId('account-form-kind') as HTMLSelectElement;
    expect(Array.from(kind.options).map((o) => o.textContent)).toEqual([
      'Bank account',
      'Credit card',
      'Cash',
      'Other',
    ]);
    // No literal key path leaked into the rendered text.
    expect(dialog.textContent).not.toMatch(/accounts\.[a-zA-Z]+\./);
  });
});
