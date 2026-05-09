import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsScopeTabs } from './PaymentsScopeTabs';

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('PaymentsScopeTabs', () => {
  it('renders All + Personal tabs when no groups', () => {
    render(<PaymentsScopeTabs current="all" groups={[]} />);
    expect(screen.getByTestId('scope-tab-all')).toBeInTheDocument();
    expect(screen.getByTestId('scope-tab-personal')).toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(2);
  });

  it('renders one tab per group', () => {
    render(
      <PaymentsScopeTabs
        current="all"
        groups={[
          { id: 'g-1', name: 'Family' },
          { id: 'g-2', name: 'Roommates' },
        ]}
      />,
    );
    expect(screen.getByTestId('scope-tab-group:g-1')).toHaveTextContent('Family');
    expect(screen.getByTestId('scope-tab-group:g-2')).toHaveTextContent('Roommates');
  });

  it('All tab → /payments href', () => {
    render(<PaymentsScopeTabs current="all" groups={[]} />);
    expect(screen.getByTestId('scope-tab-all')).toHaveAttribute('href', '/payments');
  });

  it('Personal tab → /payments?scope=personal href', () => {
    render(<PaymentsScopeTabs current="all" groups={[]} />);
    expect(screen.getByTestId('scope-tab-personal')).toHaveAttribute(
      'href',
      '/payments?scope=personal',
    );
  });

  it('Group tab → /payments?scope=group:<id> href', () => {
    render(<PaymentsScopeTabs current="all" groups={[{ id: 'g-1', name: 'Family' }]} />);
    expect(screen.getByTestId('scope-tab-group:g-1')).toHaveAttribute(
      'href',
      '/payments?scope=group:g-1',
    );
  });

  it('active tab has aria-current="page"', () => {
    render(<PaymentsScopeTabs current="personal" groups={[]} />);
    expect(screen.getByTestId('scope-tab-personal')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('scope-tab-all')).not.toHaveAttribute('aria-current', 'page');
  });

  it('container has role="tablist" and tabs have role="tab"', () => {
    render(<PaymentsScopeTabs current="all" groups={[{ id: 'g-1', name: 'Family' }]} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });
});
