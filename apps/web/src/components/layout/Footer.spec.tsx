import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Footer } from './Footer';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, _params?: Record<string, unknown>) => key,
}));

// Mock @/i18n/navigation (Link)
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe('Footer', () => {
  it('renders the footer element', () => {
    render(<Footer />);
    const footer = screen.getByRole('contentinfo');
    expect(footer).toBeInTheDocument();
  });

  it('renders copyright text', () => {
    render(<Footer />);
    expect(screen.getByText('copyright')).toBeInTheDocument();
  });

  it('renders terms link with correct href', () => {
    render(<Footer />);
    const termsLink = screen.getByText('terms');
    expect(termsLink).toBeInTheDocument();
    expect(termsLink.closest('a')).toHaveAttribute('href', '/legal/terms');
  });

  it('renders privacy link with correct href', () => {
    render(<Footer />);
    const privacyLink = screen.getByText('privacy');
    expect(privacyLink).toBeInTheDocument();
    expect(privacyLink.closest('a')).toHaveAttribute('href', '/legal/privacy');
  });

  it('renders help link with correct href', () => {
    render(<Footer />);
    const helpLink = screen.getByText('help');
    expect(helpLink).toBeInTheDocument();
    expect(helpLink.closest('a')).toHaveAttribute('href', '/help');
  });

  it('contains navigation element', () => {
    render(<Footer />);
    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
  });
});
