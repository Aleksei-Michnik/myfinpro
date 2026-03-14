import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LoginForm } from './LoginForm';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
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

describe('LoginForm', () => {
  it('renders email input with label', () => {
    render(<LoginForm />);
    // useTranslations mock returns the key: 'email'
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
    // The button text comes from t('signIn') which returns 'signIn'
    const button = screen.getByRole('button', { name: 'signIn' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'submit');
  });

  it('submit button is disabled when fields are empty', () => {
    render(<LoginForm />);
    const button = screen.getByRole('button', { name: 'signIn' });
    expect(button).toBeDisabled();
  });

  it('renders OAuth buttons (disabled)', () => {
    render(<LoginForm />);
    const googleBtn = screen.getByRole('button', { name: 'google' });
    const telegramBtn = screen.getByRole('button', { name: 'telegram' });
    expect(googleBtn).toBeInTheDocument();
    expect(googleBtn).toBeDisabled();
    expect(telegramBtn).toBeInTheDocument();
    expect(telegramBtn).toBeDisabled();
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
});
