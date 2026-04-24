import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GroupsPage from './page';
import type { GroupSummary } from '@/lib/group/types';

const mockPush = vi.fn();

let mockGroupState: {
  groups: GroupSummary[];
  isLoading: boolean;
  fetchGroups: ReturnType<typeof vi.fn>;
  createGroup: ReturnType<typeof vi.fn>;
  updateGroup: ReturnType<typeof vi.fn>;
  deleteGroup: ReturnType<typeof vi.fn>;
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { count?: number }) => {
    if (key === 'memberCount' && values?.count !== undefined) {
      return values.count === 1 ? `${values.count} member` : `${values.count} members`;
    }
    const translations: Record<string, string> = {
      title: 'My Groups',
      createGroup: 'Create Group',
      noGroups: "You don't have any groups yet.",
      createFirst: 'Create your first group to get started.',
      'type.family': 'Family',
      'role.admin': 'Admin',
      'role.member': 'Member',
      'create.title': 'Create New Group',
      'create.name': 'Group Name',
      'create.namePlaceholder': 'Enter group name',
      'create.type': 'Group Type',
      'create.currency': 'Default Currency',
      'create.cancel': 'Cancel',
      'create.create': 'Create Group',
      'create.creating': 'Creating...',
      'create.success': 'Group created successfully',
      'create.error': 'Failed to create group',
    };
    return translations[key] || key;
  },
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => '/groups',
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: { id: '1', email: 'test@test.com', name: 'Test User' },
    accessToken: 'mock-token',
    getAccessToken: () => 'mock-token',
  }),
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => mockGroupState,
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: vi.fn(),
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

const sampleGroups: GroupSummary[] = [
  {
    id: 'group-1',
    name: 'The Smiths',
    type: 'family',
    defaultCurrency: 'USD',
    createdById: 'user-1',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    memberCount: 3,
    role: 'admin',
  },
  {
    id: 'group-2',
    name: 'Roommates',
    type: 'family',
    defaultCurrency: 'ILS',
    createdById: 'user-2',
    createdAt: '2026-04-05T00:00:00Z',
    updatedAt: '2026-04-05T00:00:00Z',
    memberCount: 2,
    role: 'member',
  },
];

describe('GroupsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupState = {
      groups: [],
      isLoading: false,
      fetchGroups: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      deleteGroup: vi.fn(),
    };
  });

  it('renders page title', () => {
    render(<GroupsPage />);
    expect(screen.getByRole('heading', { name: 'My Groups' })).toBeInTheDocument();
  });

  it('renders empty state when there are no groups', () => {
    render(<GroupsPage />);
    expect(screen.getByTestId('groups-empty-state')).toBeInTheDocument();
    expect(screen.getByText("You don't have any groups yet.")).toBeInTheDocument();
    expect(screen.getByText('Create your first group to get started.')).toBeInTheDocument();
    expect(screen.getByTestId('open-create-group-btn-empty')).toBeInTheDocument();
  });

  it('renders a loading skeleton when loading with no groups', () => {
    mockGroupState.isLoading = true;
    render(<GroupsPage />);
    expect(screen.getByTestId('groups-loading-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('groups-empty-state')).not.toBeInTheDocument();
  });

  it('renders a grid of group cards when groups exist', () => {
    mockGroupState.groups = sampleGroups;
    render(<GroupsPage />);
    expect(screen.getByTestId('groups-grid')).toBeInTheDocument();
    expect(screen.getByTestId('group-card-group-1')).toBeInTheDocument();
    expect(screen.getByTestId('group-card-group-2')).toBeInTheDocument();
    expect(screen.getByText('The Smiths')).toBeInTheDocument();
    expect(screen.getByText('Roommates')).toBeInTheDocument();
  });

  it('shows the "Create Group" header button when groups exist', () => {
    mockGroupState.groups = sampleGroups;
    render(<GroupsPage />);
    expect(screen.getByTestId('open-create-group-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('groups-empty-state')).not.toBeInTheDocument();
  });

  it('opens the create dialog when clicking the empty state CTA', () => {
    render(<GroupsPage />);
    expect(screen.queryByTestId('create-group-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('open-create-group-btn-empty'));

    expect(screen.getByTestId('create-group-dialog')).toBeInTheDocument();
  });

  it('opens the create dialog when clicking the header button', () => {
    mockGroupState.groups = sampleGroups;
    render(<GroupsPage />);

    fireEvent.click(screen.getByTestId('open-create-group-btn'));

    expect(screen.getByTestId('create-group-dialog')).toBeInTheDocument();
  });

  it('closes the create dialog when cancel is clicked', () => {
    render(<GroupsPage />);
    fireEvent.click(screen.getByTestId('open-create-group-btn-empty'));
    expect(screen.getByTestId('create-group-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cancel-create-group-btn'));

    expect(screen.queryByTestId('create-group-dialog')).not.toBeInTheDocument();
  });
});
