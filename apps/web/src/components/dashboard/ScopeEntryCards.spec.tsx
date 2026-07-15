import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScopeEntryCards } from './ScopeEntryCards';
import type { TransactionSummary } from '@/lib/transaction/types';

const mockFetchList = vi.fn();
const mockUseGroups = vi.fn();

// Mock useTranslations so each namespace prefixes its keys; this lets us
// regression-test that the component DOES NOT reference a phantom
// `dashboard.scopes.in/out/net` namespace (only `dashboard.totals.*` is real).
vi.mock('next-intl', () => ({
  useLocale: () => 'en-US',
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', defaultCurrency: 'USD' } }),
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => mockUseGroups(),
}));

vi.mock('@/lib/transaction/transaction-context', () => ({
  useTransactions: () => ({ fetchList: mockFetchList }),
}));

function makeTransaction(p: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: p.id ?? 'p',
    direction: p.direction ?? 'OUT',
    type: 'ONE_TIME',
    amountCents: p.amountCents ?? 1000,
    currency: p.currency ?? 'USD',
    occurredAt: '2026-04-25T00:00:00Z',
    status: 'POSTED',
    category: { id: 'c', slug: 'misc', name: 'Misc', icon: null, color: null },
    attributions: p.attributions ?? [
      { scope: 'personal', userId: 'me', groupId: null, groupName: null },
    ],
    note: null,
    commentCount: 0,
    starredByMe: false,
    hasDocuments: false,
    parentTransactionId: null,
    createdById: 'me',
    createdAt: '2026-04-25T00:00:00Z',
    updatedAt: '2026-04-25T00:00:00Z',
  };
}

describe('ScopeEntryCards', () => {
  beforeEach(() => {
    mockFetchList.mockReset();
    mockUseGroups.mockReset();
    mockUseGroups.mockReturnValue({ groups: [] });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Personal card always rendered first', async () => {
    render(<ScopeEntryCards transactions={[]} groups={[{ id: 'g1', name: 'Family' }]} />);
    const list = await screen.findByTestId('scope-cards');
    const items = list.querySelectorAll('article');
    expect(items[0]?.getAttribute('data-testid')).toBe('scope-card-personal');
    expect(items[1]?.getAttribute('data-testid')).toBe('scope-card-group-g1');
  });

  it('renders one card per group provided via prop', async () => {
    render(
      <ScopeEntryCards
        transactions={[]}
        groups={[
          { id: 'g1', name: 'Family' },
          { id: 'g2', name: 'Roommates' },
        ]}
      />,
    );
    expect(await screen.findByTestId('scope-card-group-g1')).toBeInTheDocument();
    expect(screen.getByTestId('scope-card-group-g2')).toBeInTheDocument();
  });

  it('renders the role badge when group has role', async () => {
    render(
      <ScopeEntryCards transactions={[]} groups={[{ id: 'g1', name: 'Family', role: 'admin' }]} />,
    );
    expect(await screen.findByTestId('scope-card-group-g1-role')).toBeInTheDocument();
  });

  it('computes per-card totals locally from `transactions` prop', async () => {
    render(
      <ScopeEntryCards
        groups={[{ id: 'g1', name: 'Family' }]}
        transactions={[
          makeTransaction({
            id: 'a',
            direction: 'OUT',
            amountCents: 5000,
            attributions: [{ scope: 'personal', userId: 'me', groupId: null, groupName: null }],
          }),
          makeTransaction({
            id: 'b',
            direction: 'IN',
            amountCents: 8000,
            attributions: [{ scope: 'group', userId: null, groupId: 'g1', groupName: 'Family' }],
          }),
        ]}
      />,
    );
    const personal = await screen.findByTestId('scope-card-personal-totals');
    expect(personal.textContent).toContain('50.00');
    const group = screen.getByTestId('scope-card-group-g1-totals');
    expect(group.textContent).toContain('80.00');
  });

  it('uses `dashboard.totals.in/out/net` for amount labels (DRY: same as <TotalsCard>)', async () => {
    render(
      <ScopeEntryCards
        transactions={[
          makeTransaction({
            id: 'a',
            direction: 'IN',
            amountCents: 1000,
            attributions: [{ scope: 'personal', userId: 'me', groupId: null, groupName: null }],
          }),
          makeTransaction({
            id: 'b',
            direction: 'OUT',
            amountCents: 823,
            attributions: [{ scope: 'personal', userId: 'me', groupId: null, groupName: null }],
          }),
        ]}
        groups={[]}
      />,
    );
    const totals = await screen.findByTestId('scope-card-personal-totals');
    expect(totals.textContent).toContain('dashboard.totals.in');
    expect(totals.textContent).toContain('dashboard.totals.out');
    expect(totals.textContent).toContain('dashboard.totals.net');
  });

  it('regression: never references `dashboard.scopes.in/out/net` (the phantom keys)', async () => {
    const { container } = render(
      <ScopeEntryCards
        transactions={[
          makeTransaction({
            id: 'a',
            direction: 'IN',
            amountCents: 1000,
            attributions: [{ scope: 'personal', userId: 'me', groupId: null, groupName: null }],
          }),
          makeTransaction({
            id: 'b',
            direction: 'OUT',
            amountCents: 823,
            attributions: [{ scope: 'personal', userId: 'me', groupId: null, groupName: null }],
          }),
        ]}
        groups={[]}
      />,
    );
    await screen.findByTestId('scope-card-personal-totals');
    const text = container.textContent ?? '';
    expect(text).not.toContain('dashboard.scopes.in');
    expect(text).not.toContain('dashboard.scopes.out');
    expect(text).not.toContain('dashboard.scopes.net');
  });

  it('"View" links use the correct scope query param', async () => {
    render(<ScopeEntryCards transactions={[]} groups={[{ id: 'g1', name: 'Family' }]} />);
    expect((await screen.findByTestId('scope-card-personal-view')).getAttribute('href')).toBe(
      '/transactions?scope=personal',
    );
    expect(screen.getByTestId('scope-card-group-g1-view').getAttribute('href')).toBe(
      '/transactions?scope=group:g1',
    );
  });

  it('shows "No activity yet" when the scope has no matching transactions', async () => {
    render(
      <ScopeEntryCards
        groups={[{ id: 'g1', name: 'Family' }]}
        transactions={[
          makeTransaction({
            attributions: [{ scope: 'personal', userId: 'me', groupId: null, groupName: null }],
          }),
        ]}
      />,
    );
    expect(await screen.findByTestId('scope-card-group-g1-empty')).toBeInTheDocument();
  });

  it('shows "Create a group" CTA when user has no groups', async () => {
    render(<ScopeEntryCards transactions={[]} groups={[]} />);
    expect(await screen.findByTestId('scope-cards-empty-groups')).toBeInTheDocument();
  });

  it('falls back to useGroups() when groups prop is omitted', async () => {
    mockUseGroups.mockReturnValue({ groups: [{ id: 'gx', name: 'Hookbacks' }] });
    render(<ScopeEntryCards transactions={[]} />);
    expect(await screen.findByTestId('scope-card-group-gx')).toBeInTheDocument();
  });

  it('fetches transactions when neither `transactions` nor groups have data', async () => {
    mockFetchList.mockResolvedValueOnce({ data: [], nextCursor: null, hasMore: false });
    render(
      <ScopeEntryCards groups={[]} fromIso="2026-05-01T00:00:00Z" toIso="2026-06-01T00:00:00Z" />,
    );
    await waitFor(() => expect(mockFetchList).toHaveBeenCalledTimes(1));
    const params = mockFetchList.mock.calls[0][0];
    expect(params.from).toBe('2026-05-01T00:00:00Z');
    expect(params.to).toBe('2026-06-01T00:00:00Z');
  });
});
