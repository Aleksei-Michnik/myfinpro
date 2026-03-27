import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Header } from './Header';

const mockLogout = vi.fn();

// Default mock state — unauthenticated
let mockAuthState = {
  user: null as { name: string } | null,
  isAuthenticated: false,
  isLoading: false,
  logout: mockLogout,
  accessToken: null as string | null,
  login: vi.fn(),
  loginWithToken: vi.fn(),
  loginWithTelegram: vi.fn(),
  register: vi.fn(),
  getAccessToken: () => null as string | null,
};

// Mock next-intl hooks
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));

// Mock @/i18n/navigation (Link, etc.)
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Mock @/i18n/routing
vi.mock('@/i18n/routing', () => ({
  routing: {
    locales: ['en', 'he'],
    defaultLocale: 'en',
  },
}));

// Mock auth context
vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => mockAuthState,
}));

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to unauthenticated
    mockAuthState = {
      user: null,
      isAuthenticated: false,
      isLoading: false,
      logout: mockLogout,
      accessToken: null,
      login: vi.fn(),
      loginWithToken: vi.fn(),
      loginWithTelegram: vi.fn(),
      register: vi.fn(),
      getAccessToken: () => null,
    };
  });

  it('renders the header element', () => {
    render(<Header />);
    const header = screen.getByRole('banner');
    expect(header).toBeInTheDocument();
  });

  it('displays app name via translation key', () => {
    render(<Header />);
    expect(screen.getByText('common.appName')).toBeInTheDocument();
  });

  it('renders app name as a link to home', () => {
    render(<Header />);
    const appNameLink = screen.getByText('common.appName');
    expect(appNameLink.closest('a')).toHaveAttribute('href', '/');
  });

  it('contains navigation element', () => {
    render(<Header />);
    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
  });

  it('renders home navigation link', () => {
    render(<Header />);
    expect(screen.getByText('nav.home')).toBeInTheDocument();
  });

  it('renders locale switcher links for all locales', () => {
    render(<Header />);
    expect(screen.getByText('EN')).toBeInTheDocument();
    expect(screen.getByText('HE')).toBeInTheDocument();
  });

  it('highlights the current locale', () => {
    render(<Header />);
    const enLink = screen.getByText('EN');
    expect(enLink.className).toContain('bg-primary-100');
    expect(enLink.className).toContain('font-medium');
  });

  it('does not highlight non-current locale', () => {
    render(<Header />);
    const heLink = screen.getByText('HE');
    expect(heLink.className).not.toContain('bg-primary-100');
    expect(heLink.className).toContain('text-gray-500');
  });

  describe('when unauthenticated', () => {
    it('renders sign in navigation link', () => {
      render(<Header />);
      const signInLink = screen.getByText('nav.signIn');
      expect(signInLink).toBeInTheDocument();
      expect(signInLink.closest('a')).toHaveAttribute('href', '/auth/login');
    });

    it('renders sign up navigation link', () => {
      render(<Header />);
      const signUpLink = screen.getByText('nav.signUp');
      expect(signUpLink).toBeInTheDocument();
      expect(signUpLink.closest('a')).toHaveAttribute('href', '/auth/register');
    });

    it('does not render user name or logout', () => {
      render(<Header />);
      expect(screen.queryByTestId('user-name')).not.toBeInTheDocument();
      expect(screen.queryByText('nav.logout')).not.toBeInTheDocument();
    });
  });

  describe('when authenticated', () => {
    beforeEach(() => {
      mockAuthState = {
        user: { name: 'Test User' },
        isAuthenticated: true,
        isLoading: false,
        logout: mockLogout,
        accessToken: 'token',
        login: vi.fn(),
        loginWithToken: vi.fn(),
        loginWithTelegram: vi.fn(),
        register: vi.fn(),
        getAccessToken: () => 'token',
      };
    });

    it('renders user name', () => {
      render(<Header />);
      expect(screen.getByTestId('user-name')).toHaveTextContent('Test User');
    });

    it('renders dashboard link', () => {
      render(<Header />);
      const dashboardLink = screen.getByText('nav.dashboard');
      expect(dashboardLink).toBeInTheDocument();
      expect(dashboardLink.closest('a')).toHaveAttribute('href', '/dashboard');
    });

    it('renders logout button', () => {
      render(<Header />);
      const logoutBtn = screen.getByText('nav.logout');
      expect(logoutBtn).toBeInTheDocument();
      expect(logoutBtn.tagName).toBe('BUTTON');
    });

    it('calls logout when logout button clicked', () => {
      render(<Header />);
      fireEvent.click(screen.getByText('nav.logout'));
      expect(mockLogout).toHaveBeenCalled();
    });

    it('does not render sign in/sign up links', () => {
      render(<Header />);
      expect(screen.queryByText('nav.signIn')).not.toBeInTheDocument();
      expect(screen.queryByText('nav.signUp')).not.toBeInTheDocument();
    });
  });

  describe('when loading', () => {
    beforeEach(() => {
      mockAuthState = {
        ...mockAuthState,
        isLoading: true,
      };
    });

    it('does not render auth links while loading', () => {
      render(<Header />);
      expect(screen.queryByText('nav.signIn')).not.toBeInTheDocument();
      expect(screen.queryByText('nav.signUp')).not.toBeInTheDocument();
      expect(screen.queryByText('nav.logout')).not.toBeInTheDocument();
    });
  });
});
