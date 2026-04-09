import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoginForm } from './LoginForm';

const mockLogin = vi.fn();
const mockPush = vi.fn();

// Save original location
const originalLocation = window.location;

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

// Mock @/i18n/navigation (Link, useRouter, etc.)
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => '/',
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

// Mock auth context
vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    login: mockLogin,
    loginWithToken: vi.fn(),
    loginWithTelegram: vi.fn(),
    user: null,
    isAuthenticated: false,
    isLoading: false,
    accessToken: null,
    register: vi.fn(),
    logout: vi.fn(),
    getAccessToken: () => null,
    resendVerificationEmail: vi.fn(),
    refreshUser: vi.fn(),
  }),
}));

// Mock useTelegramLogin hook
vi.mock('@/components/auth/TelegramLoginButton', () => ({
  useTelegramLogin: () => ({
    triggerLogin: vi.fn(),
    isReady: false,
    isLoading: false,
  }),
}));

const mockAddToast = vi.fn();

// Mock Toast
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.location for Google button tests
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, href: '' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('renders email input with label', () => {
    render(<LoginForm />);
    const emailInput = screen.getByLabelText('email');
    expect(emailInput).toBeInTheDocument();
    expect(emailInput).toHaveAttribute('type', 'email');
  });

  it('renders password input with label', () => {
    render(<LoginForm />);
    const passwordInput = screen.getByLabelText('password');
    expect(passwordInput).toBeInTheDocument();
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('renders sign in button', () => {
    render(<LoginForm />);
    const button = screen.getByRole('button', { name: 'signIn' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'submit');
  });

  it('submit button is disabled when fields are empty', () => {
    render(<LoginForm />);
    const button = screen.getByRole('button', { name: 'signIn' });
    expect(button).toBeDisabled();
  });

  it('renders Google button as enabled and Telegram button as disabled', () => {
    render(<LoginForm />);
    const googleBtn = screen.getByRole('button', { name: 'google' });
    const telegramBtn = screen.getByRole('button', { name: 'telegram' });
    expect(googleBtn).toBeInTheDocument();
    expect(googleBtn).toBeEnabled();
    expect(telegramBtn).toBeInTheDocument();
    expect(telegramBtn).toBeDisabled();
  });

  it('Google button navigates to OAuth endpoint on click', () => {
    render(<LoginForm />);
    const googleBtn = screen.getByRole('button', { name: 'google' });
    fireEvent.click(googleBtn);
    expect(window.location.href).toBe('/api/v1/auth/google');
  });

  it('renders "or sign in with" divider text', () => {
    render(<LoginForm />);
    expect(screen.getByText('orSignInWith')).toBeInTheDocument();
  });

  it('has link to registration page', () => {
    render(<LoginForm />);
    const signUpLink = screen.getByText('signUp');
    expect(signUpLink.closest('a')).toHaveAttribute('href', '/auth/register');
  });

  it('renders "no account" text', () => {
    render(<LoginForm />);
    expect(screen.getByText('noAccount')).toBeInTheDocument();
  });

  it('renders form element with noValidate', () => {
    const { container } = render(<LoginForm />);
    const form = container.querySelector('form');
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute('novalidate');
  });

  it('email input has autocomplete attribute', () => {
    render(<LoginForm />);
    const emailInput = screen.getByLabelText('email');
    expect(emailInput).toHaveAttribute('autocomplete', 'email');
  });

  it('password input has autocomplete attribute', () => {
    render(<LoginForm />);
    const passwordInput = screen.getByLabelText('password');
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
  });

  it('calls login and redirects to dashboard on success', async () => {
    mockLogin.mockResolvedValueOnce(undefined);

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText('email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('password'), {
      target: { value: 'Password1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'signIn' }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'Password1',
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows error message on login failure', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'));

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText('email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText('password'), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'signIn' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
    });
  });
});
