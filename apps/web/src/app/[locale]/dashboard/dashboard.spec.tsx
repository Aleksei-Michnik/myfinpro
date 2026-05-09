import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DashboardPage from './page';

const mockPush = vi.fn();
const totalsMounts = vi.fn();
const scopesMounts = vi.fn();
const recentMounts = vi.fn();
const starredMounts = vi.fn();
let savedHandler: ((p: { id: string }) => void) | null = null;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: {
      id: 'me',
      email: 'me@test.com',
      name: 'Me',
      defaultCurrency: 'USD',
      locale: 'en',
      emailVerified: true,
    },
    accessToken: 'tok',
    getAccessToken: () => 'tok',
  }),
}));

vi.mock('@/components/dashboard/TotalsCard', () => ({
  TotalsCard: () => {
    totalsMounts();
    return <div data-testid="mocked-totals" />;
  },
}));

vi.mock('@/components/dashboard/ScopeEntryCards', () => ({
  ScopeEntryCards: () => {
    scopesMounts();
    return <div data-testid="mocked-scopes" />;
  },
}));

vi.mock('@/components/dashboard/RecentActivity', () => ({
  RecentActivity: () => {
    recentMounts();
    return <div data-testid="mocked-recent" />;
  },
}));

vi.mock('@/components/dashboard/StarredPayments', () => ({
  StarredPayments: () => {
    starredMounts();
    return <div data-testid="mocked-starred" />;
  },
}));

vi.mock('@/components/dashboard/QuickAddPaymentButton', () => ({
  QuickAddPaymentButton: ({
    onPaymentCreated,
  }: {
    onPaymentCreated?: (p: { id: string }) => void;
  }) => {
    savedHandler = onPaymentCreated ?? null;
    return (
      <button
        type="button"
        data-testid="mocked-quick-add"
        onClick={() => onPaymentCreated?.({ id: 'created-1' })}
      >
        + Add payment
      </button>
    );
  },
}));

describe('DashboardPage', () => {
  it('wraps content in ProtectedRoute (renders for authenticated user)', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('dashboard-main')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('renders title and subtitle from i18n', () => {
    render(<DashboardPage />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    // Translation key passthrough via the mocked useTranslations
    expect(screen.getByText('subtitle')).toBeInTheDocument();
  });

  it('renders all four dashboard sections', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('mocked-totals')).toBeInTheDocument();
    expect(screen.getByTestId('mocked-scopes')).toBeInTheDocument();
    expect(screen.getByTestId('mocked-recent')).toBeInTheDocument();
    expect(screen.getByTestId('mocked-starred')).toBeInTheDocument();
  });

  it('renders the QuickAddPaymentButton at the top', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('mocked-quick-add')).toBeInTheDocument();
  });

  it('successful payment creation re-mounts every section (refreshKey bump)', () => {
    totalsMounts.mockClear();
    scopesMounts.mockClear();
    recentMounts.mockClear();
    starredMounts.mockClear();
    render(<DashboardPage />);
    expect(totalsMounts).toHaveBeenCalledTimes(1);
    expect(scopesMounts).toHaveBeenCalledTimes(1);
    expect(recentMounts).toHaveBeenCalledTimes(1);
    expect(starredMounts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('mocked-quick-add'));

    expect(totalsMounts).toHaveBeenCalledTimes(2);
    expect(scopesMounts).toHaveBeenCalledTimes(2);
    expect(recentMounts).toHaveBeenCalledTimes(2);
    expect(starredMounts).toHaveBeenCalledTimes(2);
  });

  it('refreshKey bump is idempotent across multiple creations', () => {
    totalsMounts.mockClear();
    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId('mocked-quick-add'));
    fireEvent.click(screen.getByTestId('mocked-quick-add'));
    fireEvent.click(screen.getByTestId('mocked-quick-add'));
    // Initial mount + 3 re-mounts = 4
    expect(totalsMounts).toHaveBeenCalledTimes(4);
  });

  it('does not redirect for an authenticated user', () => {
    mockPush.mockClear();
    render(<DashboardPage />);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('quick-add button receives onPaymentCreated handler from the parent', () => {
    render(<DashboardPage />);
    expect(savedHandler).not.toBeNull();
  });
});
