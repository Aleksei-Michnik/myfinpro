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
  resendVerificationEmail: vi.fn(),
  refreshUser: vi.fn(),
};

// Mock next/navigation
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: mockRefresh }),
}));

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
  locales: ['en', 'he'] as const,
  defaultLocale: 'en',
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
      resendVerificationEmail: vi.fn(),
      refreshUser: vi.fn(),
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

  it('renders locale switcher dropdown with all locales', () => {
    render(<Header />);
    const select = screen.getByRole('combobox', { name: 'Select language' });
    expect(select).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('עברית')).toBeInTheDocument();
  });

  it('has current locale selected in dropdown', () => {
    render(<Header />);
    const select = screen.getByRole('combobox', { name: 'Select language' });
    expect(select).toHaveValue('en');
  });

  it('sets cookie and refreshes router on locale switch', () => {
    render(<Header />);
    const select = screen.getByRole('combobox', { name: 'Select language' });
    fireEvent.change(select, { target: { value: 'he' } });
    expect(document.cookie).toContain('NEXT_LOCALE=he');
    expect(mockRefresh).toHaveBeenCalled();
  });

  describe('when unauthenticated', () => {
    it('contains a navigation landmark with public links', () => {
      render(<Header />);
      const nav = screen.getByRole('navigation');
      expect(nav).toBeInTheDocument();
    });

    it('renders home navigation link', () => {
      render(<Header />);
      expect(screen.getByText('nav.home')).toBeInTheDocument();
    });

    it('renders help navigation link', () => {
      render(<Header />);
      const helpLink = screen.getByText('nav.help');
      expect(helpLink).toBeInTheDocument();
      expect(helpLink.closest('a')).toHaveAttribute('href', '/help');
    });

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

    it('does not render user name, logout, or sidebar toggle', () => {
      render(<Header />);
      expect(screen.queryByTestId('user-name')).not.toBeInTheDocument();
      expect(screen.queryByText('nav.logout')).not.toBeInTheDocument();
      expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument();
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
        resendVerificationEmail: vi.fn(),
        refreshUser: vi.fn(),
      };
    });

    it('renders user name', () => {
      render(<Header />);
      expect(screen.getByTestId('user-name')).toHaveTextContent('Test User');
    });

    it('does not render page links (they live in the Sidebar)', () => {
      render(<Header />);
      expect(screen.queryByText('nav.dashboard')).not.toBeInTheDocument();
      expect(screen.queryByText('nav.groups')).not.toBeInTheDocument();
      expect(screen.queryByText('nav.settings')).not.toBeInTheDocument();
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

    it('renders an accessible sidebar toggle when a handler is provided', () => {
      const onSidebarToggle = vi.fn();
      render(<Header isSidebarOpen={false} onSidebarToggle={onSidebarToggle} />);

      const toggle = screen.getByTestId('sidebar-toggle');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveAttribute('aria-controls', 'app-sidebar');
      expect(toggle).toHaveAttribute('aria-label', 'nav.menu');

      fireEvent.click(toggle);
      expect(onSidebarToggle).toHaveBeenCalled();
    });

    it('reflects the open drawer state on the toggle', () => {
      render(<Header isSidebarOpen onSidebarToggle={vi.fn()} />);

      const toggle = screen.getByTestId('sidebar-toggle');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveAttribute('aria-label', 'nav.closeMenu');
    });

    it('does not render the sidebar toggle without a handler', () => {
      render(<Header />);
      expect(screen.queryByTestId('sidebar-toggle')).not.toBeInTheDocument();
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
