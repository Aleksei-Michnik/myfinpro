import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TokensSettingsPage from './page';
import type { ApiTokenSummary } from '@/lib/auth/types';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations:
    (namespace?: string) => (key: string, values?: Record<string, string | number>) => {
      const full = namespace ? `${namespace}.${key}` : key;
      if (!values) return full;
      return `${full}:${JSON.stringify(values)}`;
    },
}));

vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockReplace = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

const mockAddToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }),
}));

const mockListTokens = vi.fn();
const mockCreateToken = vi.fn();
const mockRevokeToken = vi.fn();
vi.mock('@/lib/auth/use-api-tokens', () => ({
  useApiTokens: () => ({
    listTokens: mockListTokens,
    createToken: mockCreateToken,
    revokeToken: mockRevokeToken,
  }),
}));

function makeToken(overrides: Partial<ApiTokenSummary> = {}): ApiTokenSummary {
  return {
    id: 't-1',
    name: 'Laptop connector',
    scopes: ['accounts:import'],
    lastUsedAt: null,
    expiresAt: null,
    createdAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

describe('TokensSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page shell and fetches tokens on mount', async () => {
    mockListTokens.mockResolvedValue([]);
    render(<TokensSettingsPage />);
    expect(screen.getByTestId('tokens-page')).toBeInTheDocument();
    await waitFor(() => expect(mockListTokens).toHaveBeenCalled());
  });

  it('shows the empty state with the import-instead link when there are no tokens', async () => {
    mockListTokens.mockResolvedValue([]);
    render(<TokensSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('tokens-empty')).toBeInTheDocument());
    expect(screen.getByTestId('tokens-empty-import-link')).toHaveAttribute('href', '/accounts');
  });

  it('renders one row per token', async () => {
    mockListTokens.mockResolvedValue([makeToken({ id: 't-1' }), makeToken({ id: 't-2' })]);
    render(<TokensSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('tokens-list')).toBeInTheDocument());
    expect(screen.getByTestId('token-row-t-1')).toBeInTheDocument();
    expect(screen.getByTestId('token-row-t-2')).toBeInTheDocument();
  });

  it('Refresh re-fetches the list', async () => {
    mockListTokens.mockResolvedValue([]);
    render(<TokensSettingsPage />);
    await waitFor(() => expect(mockListTokens).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('tokens-refresh'));
    await waitFor(() => expect(mockListTokens).toHaveBeenCalledTimes(2));
  });

  it('opens the create dialog from New token', async () => {
    mockListTokens.mockResolvedValue([]);
    render(<TokensSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('tokens-empty')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('tokens-new'));
    expect(screen.getByTestId('token-create-dialog')).toBeInTheDocument();
  });

  it('disables New token and shows the limit hint at the cap', async () => {
    mockListTokens.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => makeToken({ id: `t-${i}` })),
    );
    render(<TokensSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('tokens-list')).toBeInTheDocument());

    expect(screen.getByTestId('tokens-new')).toBeDisabled();
    expect(screen.getByTestId('tokens-limit-hint')).toBeInTheDocument();
  });

  it('revokes a token through the confirm dialog and removes its row', async () => {
    mockListTokens.mockResolvedValue([makeToken({ id: 't-1' })]);
    mockRevokeToken.mockResolvedValue(undefined);
    render(<TokensSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('token-row-t-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('token-revoke-t-1'));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(mockRevokeToken).toHaveBeenCalledWith('t-1', expect.anything()));
    await waitFor(() => expect(screen.getByTestId('tokens-empty')).toBeInTheDocument());
  });

  it('opens the retry/return dialog on an initial load failure and returns to /settings/account', async () => {
    mockListTokens.mockRejectedValue(new Error('network down'));
    render(<TokensSettingsPage />);

    await waitFor(() => expect(screen.getByTestId('retry-return-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('retry-return-dialog-return'));
    expect(mockReplace).toHaveBeenCalledWith('/settings/account');
  });
});
