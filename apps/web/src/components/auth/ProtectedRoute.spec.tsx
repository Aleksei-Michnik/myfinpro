import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';

const mockPush = vi.fn();
let mockAuthState = {
  isAuthenticated: false,
  isLoading: false,
  user: null as { id: string; email: string; name: string; defaultCurrency: string; locale: string } | null,
  accessToken: null as string | null,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  getAccessToken: () => null as string | null,
};

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
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

// Mock auth context
vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => mockAuthState,
}));

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = {
      isAuthenticated: false,
      isLoading: false,
      user: null,
      accessToken: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      getAccessToken: () => null,
    };
  });

  it('renders children when authenticated', () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = {
      id: '1',
      email: 'test@test.com',
      name: 'Test User',
      defaultCurrency: 'USD',
      locale: 'en',
    };
    mockAuthState.accessToken = 'mock-token';

    render(
      <ProtectedRoute>
        <div data-testid="protected-content">Protected Content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('redirects to login when not authenticated', () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isLoading = false;

    render(
      <ProtectedRoute>
        <div data-testid="protected-content">Protected Content</div>
      </ProtectedRoute>,
    );

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(mockPush).toHaveBeenCalledWith(
      '/auth/login?redirect=%2Fdashboard',
    );
  });

  it('shows loading spinner when isLoading is true', () => {
    mockAuthState.isLoading = true;
    mockAuthState.isAuthenticated = false;

    const { container } = render(
      <ProtectedRoute>
        <div data-testid="protected-content">Protected Content</div>
      </ProtectedRoute>,
    );

    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not redirect while loading', () => {
    mockAuthState.isLoading = true;
    mockAuthState.isAuthenticated = false;

    render(
      <ProtectedRoute>
        <div>Content</div>
      </ProtectedRoute>,
    );

    expect(mockPush).not.toHaveBeenCalled();
  });
});
