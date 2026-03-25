import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DashboardPage from './page';

const mockPush = vi.fn();

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      title: 'Dashboard',
      welcome: 'Welcome to MyFinPro! Your personal finance dashboard will appear here.',
    };
    return translations[key] || key;
  },
}));

// Mock @/i18n/navigation
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

// Mock auth context — authenticated user
vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: {
      id: '1',
      email: 'test@test.com',
      name: 'Test User',
      defaultCurrency: 'USD',
      locale: 'en',
    },
    accessToken: 'mock-token',
    login: vi.fn(),
    loginWithToken: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getAccessToken: () => 'mock-token',
  }),
}));

describe('DashboardPage', () => {
  it('renders dashboard page with title and welcome text', () => {
    render(<DashboardPage />);

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(
      screen.getByText('Welcome to MyFinPro! Your personal finance dashboard will appear here.'),
    ).toBeInTheDocument();
  });

  it('wraps content in ProtectedRoute (renders when authenticated)', () => {
    render(<DashboardPage />);

    // If ProtectedRoute works correctly with authenticated state, content should render
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('does not redirect when user is authenticated', () => {
    render(<DashboardPage />);

    expect(mockPush).not.toHaveBeenCalled();
  });
});
