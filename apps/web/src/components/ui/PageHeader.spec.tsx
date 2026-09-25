import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

describe('PageHeader (20.1)', () => {
  it('renders an h1 with the standard title style', () => {
    render(<PageHeader title="Budgets" data-testid="header" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Budgets' });
    expect(heading.className).toContain('text-2xl');
    expect(heading.className).toContain('dark:text-gray-100');
  });

  it('renders description, eyebrow and actions', () => {
    render(
      <PageHeader
        title="Products"
        eyebrow="Catalog"
        description="Everything you bought"
        actions={<button type="button">New</button>}
      />,
    );
    expect(screen.getByText('Catalog')).toBeInTheDocument();
    expect(screen.getByText('Everything you bought')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('supports the large marketing size, an h2 level and a title id', () => {
    render(<PageHeader title="Privacy" as="h2" size="lg" titleId="privacy-title" />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Privacy' });
    expect(heading.className).toContain('text-3xl');
    expect(heading).toHaveAttribute('id', 'privacy-title');
  });
});
