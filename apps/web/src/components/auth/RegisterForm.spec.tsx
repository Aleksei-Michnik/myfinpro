import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RegisterForm } from './RegisterForm';

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

describe('RegisterForm', () => {
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

  it('submit button is enabled when all fields have values', () => {
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('password'), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByLabelText('confirmPassword'), { target: { value: 'Password1' } });
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
});
