import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GroupCard } from './GroupCard';
import type { GroupSummary } from '@/lib/group/types';

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const fn = (key: string, values?: { count?: number }) => {
      if (key === 'memberCount' && values?.count !== undefined) {
        return values.count === 1 ? `${values.count} member` : `${values.count} members`;
      }
      if (key === 'type.family') return 'Family';
      if (key === 'role.admin') return 'Admin';
      if (key === 'role.member') return 'Member';
      return key;
    };
    return fn;
  },
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

const baseGroup: GroupSummary = {
  id: 'group-1',
  name: 'The Smiths',
  type: 'family',
  defaultCurrency: 'USD',
  createdById: 'user-1',
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
  memberCount: 3,
  role: 'admin',
};

describe('GroupCard', () => {
  it('renders group name', () => {
    render(<GroupCard group={baseGroup} />);
    expect(screen.getByTestId('group-name')).toHaveTextContent('The Smiths');
  });

  it('renders type badge with translated label', () => {
    render(<GroupCard group={baseGroup} />);
    expect(screen.getByTestId('group-type')).toHaveTextContent('Family');
  });

  it('renders member count with pluralization (plural)', () => {
    render(<GroupCard group={baseGroup} />);
    expect(screen.getByTestId('group-member-count')).toHaveTextContent('3 members');
  });

  it('renders member count with pluralization (single)', () => {
    render(<GroupCard group={{ ...baseGroup, memberCount: 1 }} />);
    expect(screen.getByTestId('group-member-count')).toHaveTextContent('1 member');
  });

  it('renders the default currency code', () => {
    render(<GroupCard group={{ ...baseGroup, defaultCurrency: 'ILS' }} />);
    expect(screen.getByTestId('group-currency')).toHaveTextContent('ILS');
  });

  it('renders admin role badge', () => {
    render(<GroupCard group={baseGroup} />);
    expect(screen.getByTestId('group-role')).toHaveTextContent('Admin');
  });

  it('renders member role badge', () => {
    render(<GroupCard group={{ ...baseGroup, role: 'member' }} />);
    expect(screen.getByTestId('group-role')).toHaveTextContent('Member');
  });

  it('omits role badge when role is undefined', () => {
    const { role: _role, ...withoutRole } = baseGroup;
    void _role;
    render(<GroupCard group={withoutRole as GroupSummary} />);
    expect(screen.queryByTestId('group-role')).not.toBeInTheDocument();
  });

  it('links to the group detail page', () => {
    render(<GroupCard group={baseGroup} />);
    const card = screen.getByTestId('group-card-group-1');
    expect(card).toHaveAttribute('href', '/groups/group-1');
  });

  it('falls back to raw type string when type is unknown', () => {
    render(<GroupCard group={{ ...baseGroup, type: 'custom' }} />);
    expect(screen.getByTestId('group-type')).toHaveTextContent('custom');
  });
});
