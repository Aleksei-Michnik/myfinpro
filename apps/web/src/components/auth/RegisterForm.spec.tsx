import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RegisterForm } from './RegisterForm';

const mockRegister = vi.fn();
const mockPush = vi.fn();

// Save original location
const originalLocation = window.location;

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.rich = (key: string, renderers?: Record<string, (chunks: unknown) => unknown>) => {
      if (!renderers) return key;
      const parts: unknown[] = [key];
      for (const [tag, renderer] of Object.entries(renderers)) {
        parts.push(renderer(tag));
      }
      return parts;
    };
    return t;
  },
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
    register: mockRegister,
    loginWithToken: vi.fn(),
    loginWithTelegram: vi.fn(),
    user: null,
    isAuthenticated: false,
    isLoading: false,
    accessToken: null,
    login: vi.fn(),
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

describe('RegisterForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('renders name input with label', () => {
    render(<RegisterForm />);
    const nameInput = screen.getByLabelText('name');
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveAttribute('type', 'text');
  });

  it('renders email input with label', () => {
    render(<RegisterForm />);
    const emailInput = screen.getByLabelText('email');
    expect(emailInput).toBeInTheDocument();
    expect(emailInput).toHaveAttribute('type', 'email');
  });

  it('renders password input with label', () => {
    render(<RegisterForm />);
    const passwordInput = screen.getByLabelText('password');
    expect(passwordInput).toBeInTheDocument();
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('renders confirm password input with label', () => {
    render(<RegisterForm />);
    const confirmInput = screen.getByLabelText('confirmPassword');
    expect(confirmInput).toBeInTheDocument();
    expect(confirmInput).toHaveAttribute('type', 'password');
  });

  it('renders create account button', () => {
    render(<RegisterForm />);
    const button = screen.getByRole('button', { name: 'signUp' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'submit');
  });

  it('submit button is disabled when fields are empty', () => {
    render(<RegisterForm />);
    const button = screen.getByRole('button', { name: 'signUp' });
    expect(button).toBeDisabled();
  });

  it('submit button is enabled when all fields have values and consent is checked', () => {
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByTestId('consent-checkbox'));
    const button = screen.getByRole('button', { name: 'signUp' });
    expect(button).toBeEnabled();
  });

  it('shows password strength indicator when typing password', () => {
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'abc' } });
    expect(screen.getByTestId('password-strength')).toBeInTheDocument();
  });

  it('has link to login page', () => {
    render(<RegisterForm />);
    const signInLink = screen.getByText('signIn');
    expect(signInLink.closest('a')).toHaveAttribute('href', '/auth/login');
  });

  it('renders "already have an account" text', () => {
    render(<RegisterForm />);
    expect(screen.getByText('hasAccount')).toBeInTheDocument();
  });

  it('shows confirm password mismatch error on blur', () => {
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'Different1' } });
    fireEvent.blur(screen.getByLabelText('confirmPassword'));
    expect(screen.getByText('passwordMismatch')).toBeInTheDocument();
  });

  it('shows name required error on blur when empty', () => {
    render(<RegisterForm />);
    fireEvent.focus(screen.getByLabelText('name'));
    fireEvent.blur(screen.getByLabelText('name'));
    expect(screen.getByText('nameRequired')).toBeInTheDocument();
  });

  it('renders form element with noValidate', () => {
    const { container } = render(<RegisterForm />);
    const form = container.querySelector('form');
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute('novalidate');
  });

  it('name input has autocomplete attribute', () => {
    render(<RegisterForm />);
    const nameInput = screen.getByLabelText('name');
    expect(nameInput).toHaveAttribute('autocomplete', 'name');
  });

  it('password input has new-password autocomplete', () => {
    render(<RegisterForm />);
    const passwordInput = screen.getByLabelText('password');
    expect(passwordInput).toHaveAttribute('autocomplete', 'new-password');
  });

  it('calls register and redirects to dashboard on success', async () => {
    mockRegister.mockResolvedValueOnce(undefined);

    render(<RegisterForm />);

    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByTestId('consent-checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'signUp' }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'Password1',
        name: 'Test User',
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows error message on registration failure', async () => {
    mockRegister.mockRejectedValueOnce(new Error('Email already exists'));

    render(<RegisterForm />);

    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByTestId('consent-checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'signUp' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Email already exists');
    });
  });

  it('renders Google sign-up button and navigates to OAuth endpoint', () => {
    render(<RegisterForm />);
    const googleBtn = screen.getByRole('button', { name: 'google' });
    expect(googleBtn).toBeInTheDocument();
    expect(googleBtn).toBeEnabled();
    fireEvent.click(googleBtn);
    expect(window.location.href).toBe('/api/v1/auth/google');
  });

  it('renders Telegram button as disabled when NEXT_PUBLIC_TELEGRAM_BOT_ID is not set', () => {
    render(<RegisterForm />);
    const telegramBtn = screen.getByRole('button', { name: 'telegram' });
    expect(telegramBtn).toBeInTheDocument();
    expect(telegramBtn).toBeDisabled();
  });

  it('renders "or sign up with" divider text', () => {
    render(<RegisterForm />);
    expect(screen.getByText('orSignUpWith')).toBeInTheDocument();
  });

  describe('consent checkbox', () => {
    it('renders consent checkbox', () => {
      render(<RegisterForm />);
      const checkbox = screen.getByTestId('consent-checkbox');
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).not.toBeChecked();
    });

    it('submit button is disabled when consent is not checked', () => {
      render(<RegisterForm />);
      fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Test User' } });
      fireEvent.change(screen.getByLabelText('email'), { target: { value: 'test@example.com' } });
      fireEvent.change(screen.getByLabelText('password'), { target: { value: 'Password1' } });
      fireEvent.change(screen.getByLabelText('confirmPassword'), {
        target: { value: 'Password1' },
      });
      const button = screen.getByRole('button', { name: 'signUp' });
      expect(button).toBeDisabled();
    });

    it('submit button is enabled when all fields filled and consent is checked', () => {
      render(<RegisterForm />);
      fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Test User' } });
      fireEvent.change(screen.getByLabelText('email'), { target: { value: 'test@example.com' } });
      fireEvent.change(screen.getByLabelText('password'), { target: { value: 'Password1' } });
      fireEvent.change(screen.getByLabelText('confirmPassword'), {
        target: { value: 'Password1' },
      });
      fireEvent.click(screen.getByTestId('consent-checkbox'));
      const button = screen.getByRole('button', { name: 'signUp' });
      expect(button).toBeEnabled();
    });

    it('submits successfully when consent is checked', async () => {
      mockRegister.mockResolvedValueOnce(undefined);

      render(<RegisterForm />);

      fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Test User' } });
      fireEvent.change(screen.getByLabelText('email'), { target: { value: 'test@example.com' } });
      fireEvent.change(screen.getByLabelText('password'), { target: { value: 'Password1' } });
      fireEvent.change(screen.getByLabelText('confirmPassword'), {
        target: { value: 'Password1' },
      });
      fireEvent.click(screen.getByTestId('consent-checkbox'));
      fireEvent.click(screen.getByRole('button', { name: 'signUp' }));

      await waitFor(() => {
        expect(mockRegister).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'Password1',
          name: 'Test User',
        });
      });

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/dashboard');
      });
    });

    it('consent links point to correct URLs', () => {
      render(<RegisterForm />);
      const links = screen
        .getAllByRole('link')
        .filter(
          (link) =>
            link.getAttribute('href') === '/legal/terms' ||
            link.getAttribute('href') === '/legal/privacy',
        );
      expect(links.length).toBeGreaterThanOrEqual(2);
      expect(links.some((l) => l.getAttribute('href') === '/legal/terms')).toBe(true);
      expect(links.some((l) => l.getAttribute('href') === '/legal/privacy')).toBe(true);
    });
  });
});
