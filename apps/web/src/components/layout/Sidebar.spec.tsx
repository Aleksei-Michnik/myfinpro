import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Sidebar } from './Sidebar';

let mockPathname = '/dashboard';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => mockPathname,
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    user: { name: 'Test User', email: 'test@example.com' },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

describe('Sidebar', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = '/dashboard';
  });

  it('renders a labelled navigation landmark', () => {
    render(<Sidebar isOpen={false} onClose={onClose} />);
    expect(screen.getByRole('navigation', { name: 'nav.menu' })).toBeInTheDocument();
  });

  it('renders all primary navigation links', () => {
    render(<Sidebar isOpen={false} onClose={onClose} />);
    expect(screen.getByText('nav.dashboard').closest('a')).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('nav.groups').closest('a')).toHaveAttribute('href', '/groups');
    expect(screen.getByText('nav.settings').closest('a')).toHaveAttribute(
      'href',
      '/settings/account',
    );
    expect(screen.getByText('nav.help').closest('a')).toHaveAttribute('href', '/help');
  });

  it('marks the active item with aria-current="page"', () => {
    render(<Sidebar isOpen={false} onClose={onClose} />);
    expect(screen.getByText('nav.dashboard').closest('a')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('nav.groups').closest('a')).not.toHaveAttribute('aria-current');
  });

  it('marks Settings active for any settings sub-page', () => {
    mockPathname = '/settings/categories';
    render(<Sidebar isOpen={false} onClose={onClose} />);
    expect(screen.getByText('nav.settings').closest('a')).toHaveAttribute('aria-current', 'page');
  });

  it('shows the user name and email at the bottom', () => {
    render(<Sidebar isOpen={false} onClose={onClose} />);
    expect(screen.getByTestId('sidebar-user-name')).toHaveTextContent('Test User');
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('is hidden on mobile when closed (hidden class present)', () => {
    render(<Sidebar isOpen={false} onClose={onClose} />);
    expect(screen.getByTestId('app-sidebar').className).toContain('hidden');
    expect(screen.queryByTestId('sidebar-overlay')).not.toBeInTheDocument();
  });

  it('shows the drawer and overlay when open', () => {
    render(<Sidebar isOpen onClose={onClose} />);
    expect(screen.getByTestId('app-sidebar').className).not.toContain('hidden');
    expect(screen.getByTestId('sidebar-overlay')).toBeInTheDocument();
  });

  it('closes when the overlay is clicked', () => {
    render(<Sidebar isOpen onClose={onClose} />);
    fireEvent.click(screen.getByTestId('sidebar-overlay'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape while open', () => {
    render(<Sidebar isOpen onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not react to Escape while closed', () => {
    render(<Sidebar isOpen={false} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
