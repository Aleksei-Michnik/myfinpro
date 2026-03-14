import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Header } from './Header';

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

describe('Header', () => {
  it('renders the header element', () => {
    render(<Header />);
    const header = screen.getByRole('banner');
    expect(header).toBeInTheDocument();
  });

  it('displays app name via translation key', () => {
    render(<Header />);
    // useTranslations mock returns the key itself
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
    // Current locale (en) should have active styling
    expect(enLink.className).toContain('bg-primary-100');
    expect(enLink.className).toContain('font-medium');
  });

  it('does not highlight non-current locale', () => {
    render(<Header />);
    const heLink = screen.getByText('HE');
    expect(heLink.className).not.toContain('bg-primary-100');
    expect(heLink.className).toContain('text-gray-500');
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
});
