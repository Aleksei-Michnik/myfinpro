import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GroupDashboardPage from './page';
import type { GroupDetail, GroupSummary } from '@/lib/group/types';

const mockPush = vi.fn();
const mockAddToast = vi.fn();

let mockGroupState: {
  groups: GroupSummary[];
  isLoading: boolean;
  fetchGroups: ReturnType<typeof vi.fn>;
  getGroup: ReturnType<typeof vi.fn>;
  createGroup: ReturnType<typeof vi.fn>;
  updateGroup: ReturnType<typeof vi.fn>;
  deleteGroup: ReturnType<typeof vi.fn>;
  getInviteInfo: ReturnType<typeof vi.fn>;
  acceptInvite: ReturnType<typeof vi.fn>;
  leaveGroup: ReturnType<typeof vi.fn>;
};

let mockParamsGroupId: string | string[] | undefined = 'group-1';

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === 'dashboard.memberCount' && values?.count !== undefined) {
      return values.count === 1 ? `${values.count} member` : `${values.count} members`;
    }
    if (key === 'dashboard.joinedOn' && values?.date !== undefined) {
      return `Joined ${values.date}`;
    }
    if (key === 'dashboard.leaveConfirmTitle' && values?.name !== undefined) {
      return `Leave ${values.name}?`;
    }
    if (key === 'dashboard.leaveSuccess' && values?.name !== undefined) {
      return `You've left ${values.name}`;
    }
    const translations: Record<string, string> = {
      'dashboard.loading': 'Loading group...',
      'dashboard.notFound': "Group not found or you don't have access",
      'dashboard.backToGroups': 'Back to Groups',
      'dashboard.settingsButton': 'Settings',
      'dashboard.overviewTitle': 'Overview',
      'dashboard.overviewPlaceholder':
        'More features coming soon — budgets, expenses, and shared goals.',
      'dashboard.membersTitle': 'Members',
      'dashboard.you': 'You',
      'dashboard.leaveButton': 'Leave Group',
      'dashboard.leaveConfirmMessage': 'Are you sure you want to leave this group?',
      'dashboard.leaveConfirmButton': 'Leave',
      'dashboard.leaveCancelButton': 'Cancel',
      'dashboard.leaveErrors.lastAdmin': "You're the last admin. Promote another member first.",
      'dashboard.leaveErrors.generic': 'Failed to leave group',
      'type.family': 'Family',
      'role.admin': 'Admin',
      'role.member': 'Member',
    };
    return translations[key] || key;
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ groupId: mockParamsGroupId }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => '/groups/group-1',
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: { id: 'user-1', email: 'alice@test.com', name: 'Alice' },
    accessToken: 'mock-token',
    getAccessToken: () => 'mock-token',
  }),
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => mockGroupState,
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

const sampleGroup: GroupDetail = {
  id: 'group-1',
  name: 'The Smiths',
  type: 'family',
  defaultCurrency: 'USD',
  createdById: 'user-1',
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
  memberCount: 3,
  role: 'admin',
  members: [
    {
      id: 'user-2',
      name: 'Bob',
      email: 'bob@test.com',
      role: 'member',
      joinedAt: '2026-04-05T00:00:00Z',
    },
    {
      id: 'user-1',
      name: 'Alice',
      email: 'alice@test.com',
      role: 'admin',
      joinedAt: '2026-04-01T00:00:00Z',
    },
    {
      id: 'user-3',
      name: 'Carol',
      email: 'carol@test.com',
      role: 'admin',
      joinedAt: '2026-04-03T00:00:00Z',
    },
  ],
};

const memberOnlyGroup: GroupDetail = {
  ...sampleGroup,
  role: 'member',
  members: [
    {
      id: 'user-9',
      name: 'Owner',
      email: 'owner@test.com',
      role: 'admin',
      joinedAt: '2026-04-01T00:00:00Z',
    },
    {
      id: 'user-1',
      name: 'Alice',
      email: 'alice@test.com',
      role: 'member',
      joinedAt: '2026-04-02T00:00:00Z',
    },
  ],
};

describe('GroupDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParamsGroupId = 'group-1';
    mockGroupState = {
      groups: [],
      isLoading: false,
      fetchGroups: vi.fn(),
      // Default: never resolves so the test sees the loading state.
      getGroup: vi.fn(() => new Promise(() => {})),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      deleteGroup: vi.fn(),
      getInviteInfo: vi.fn(),
      acceptInvite: vi.fn(),
      leaveGroup: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('renders the loading skeleton while fetching the group', () => {
    render(<GroupDashboardPage />);
    expect(screen.getByTestId('group-dashboard-loading')).toBeInTheDocument();
  });

  it('renders the group header with name, type and currency', async () => {
    mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-dashboard-header')).toBeInTheDocument();
    });

    expect(screen.getByTestId('group-dashboard-name')).toHaveTextContent('The Smiths');
    expect(screen.getByTestId('group-dashboard-type-badge')).toHaveTextContent('Family');
    expect(screen.getByTestId('group-dashboard-currency-badge')).toHaveTextContent('USD');
  });

  it('renders the members section with the correct count (plural)', async () => {
    mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-dashboard-members')).toBeInTheDocument();
    });

    expect(screen.getByTestId('group-dashboard-member-count')).toHaveTextContent('(3 members)');
  });

  it('renders singular member count when only one member', async () => {
    const singleMember: GroupDetail = {
      ...sampleGroup,
      memberCount: 1,
      members: [sampleGroup.members[1]], // just Alice
    };
    mockGroupState.getGroup = vi.fn().mockResolvedValue(singleMember);

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-dashboard-member-count')).toHaveTextContent('(1 member)');
    });
  });

  it('renders every member row with name and email', async () => {
    mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-member-row-user-1')).toBeInTheDocument();
    });

    expect(screen.getByTestId('group-member-name-user-1')).toHaveTextContent('Alice');
    expect(screen.getByTestId('group-member-email-user-1')).toHaveTextContent('alice@test.com');
    expect(screen.getByTestId('group-member-row-user-2')).toBeInTheDocument();
    expect(screen.getByTestId('group-member-row-user-3')).toBeInTheDocument();
  });

  it('marks the current user with "(You)"', async () => {
    mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-member-you-user-1')).toBeInTheDocument();
    });

    expect(screen.getByTestId('group-member-you-user-1')).toHaveTextContent('(You)');
    expect(screen.queryByTestId('group-member-you-user-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('group-member-you-user-3')).not.toBeInTheDocument();
  });

  it('shows the admin badge only for admins', async () => {
    mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-dashboard-members')).toBeInTheDocument();
    });

    expect(screen.getByTestId('group-member-admin-badge-user-1')).toHaveTextContent('Admin');
    expect(screen.getByTestId('group-member-admin-badge-user-3')).toHaveTextContent('Admin');
    expect(screen.queryByTestId('group-member-admin-badge-user-2')).not.toBeInTheDocument();
  });

  it('sorts admins first, then by joinedAt ascending', async () => {
    mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-dashboard-members')).toBeInTheDocument();
    });

    const rows = screen.getAllByTestId(/^group-member-row-/);
    // Alice (admin, joined 04-01), Carol (admin, joined 04-03), Bob (member, joined 04-05)
    expect(rows[0]).toHaveAttribute('data-testid', 'group-member-row-user-1');
    expect(rows[1]).toHaveAttribute('data-testid', 'group-member-row-user-3');
    expect(rows[2]).toHaveAttribute('data-testid', 'group-member-row-user-2');
  });

  it('shows the Settings button for admins', async () => {
    mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-dashboard-settings-btn')).toBeInTheDocument();
    });

    expect(screen.getByTestId('group-dashboard-settings-btn')).toHaveAttribute(
      'href',
      '/groups/group-1/settings',
    );
  });

  it('does not show the Settings button for non-admin members', async () => {
    mockGroupState.getGroup = vi.fn().mockResolvedValue(memberOnlyGroup);

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-dashboard-header')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('group-dashboard-settings-btn')).not.toBeInTheDocument();
  });

  it('shows the error card when the group cannot be loaded', async () => {
    mockGroupState.getGroup = vi.fn().mockRejectedValue(new Error('Not found'));

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-dashboard-error')).toBeInTheDocument();
    });

    expect(screen.getByTestId('group-dashboard-error-title')).toHaveTextContent(
      "Group not found or you don't have access",
    );
    expect(screen.getByTestId('group-dashboard-back-btn')).toBeInTheDocument();
  });

  it('navigates to /groups when clicking "Back to Groups" on the error card', async () => {
    mockGroupState.getGroup = vi.fn().mockRejectedValue(new Error('Forbidden'));

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-dashboard-back-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('group-dashboard-back-btn'));

    expect(mockPush).toHaveBeenCalledWith('/groups');
  });

  it('renders the overview placeholder', async () => {
    mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-dashboard-overview')).toBeInTheDocument();
    });

    expect(screen.getByTestId('group-dashboard-overview')).toHaveTextContent(
      'More features coming soon',
    );
  });

  it('renders the joined date for each member', async () => {
    mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);

    render(<GroupDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-member-joined-user-1')).toBeInTheDocument();
    });

    expect(screen.getByTestId('group-member-joined-user-1').textContent).toMatch(/^Joined /);
  });

  describe('Leave Group flow', () => {
    it('shows the Leave Group button for admins', async () => {
      mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);

      render(<GroupDashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId('group-dashboard-leave-btn')).toBeInTheDocument();
      });
      expect(screen.getByTestId('group-dashboard-leave-btn')).toHaveTextContent('Leave Group');
    });

    it('shows the Leave Group button for non-admin members', async () => {
      mockGroupState.getGroup = vi.fn().mockResolvedValue(memberOnlyGroup);

      render(<GroupDashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId('group-dashboard-leave-btn')).toBeInTheDocument();
      });
    });

    it('opens the confirmation dialog when Leave Group is clicked', async () => {
      mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);

      render(<GroupDashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId('group-dashboard-leave-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('group-dashboard-leave-btn'));

      expect(screen.getByTestId('group-dashboard-leave-dialog')).toBeInTheDocument();
      expect(screen.getByText('Leave The Smiths?')).toBeInTheDocument();
    });

    it('closes the dialog when Cancel is clicked', async () => {
      mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);

      render(<GroupDashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId('group-dashboard-leave-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('group-dashboard-leave-btn'));
      expect(screen.getByTestId('group-dashboard-leave-dialog')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('group-dashboard-leave-cancel-btn'));

      expect(screen.queryByTestId('group-dashboard-leave-dialog')).not.toBeInTheDocument();
      expect(mockGroupState.leaveGroup).not.toHaveBeenCalled();
    });

    it('calls leaveGroup and navigates to /groups on success', async () => {
      mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);
      mockGroupState.leaveGroup = vi.fn().mockResolvedValue(undefined);

      render(<GroupDashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId('group-dashboard-leave-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('group-dashboard-leave-btn'));
      fireEvent.click(screen.getByTestId('group-dashboard-leave-confirm-btn'));

      await waitFor(() => {
        expect(mockGroupState.leaveGroup).toHaveBeenCalledWith('group-1');
      });
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/groups');
      });
      expect(mockAddToast).toHaveBeenCalledWith('success', "You've left The Smiths");
    });

    it('shows the last-admin error toast when server responds with CANNOT_LEAVE_AS_LAST_ADMIN', async () => {
      mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);
      const err = Object.assign(new Error('Last admin'), {
        errorCode: 'GROUP_CANNOT_LEAVE_AS_LAST_ADMIN',
      });
      mockGroupState.leaveGroup = vi.fn().mockRejectedValue(err);

      render(<GroupDashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId('group-dashboard-leave-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('group-dashboard-leave-btn'));
      fireEvent.click(screen.getByTestId('group-dashboard-leave-confirm-btn'));

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith(
          'error',
          "You're the last admin. Promote another member first.",
        );
      });
      expect(mockPush).not.toHaveBeenCalledWith('/groups');
    });

    it('shows a generic error toast on unexpected failure', async () => {
      mockGroupState.getGroup = vi.fn().mockResolvedValue(sampleGroup);
      mockGroupState.leaveGroup = vi.fn().mockRejectedValue(new Error('boom'));

      render(<GroupDashboardPage />);

      await waitFor(() => {
        expect(screen.getByTestId('group-dashboard-leave-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('group-dashboard-leave-btn'));
      fireEvent.click(screen.getByTestId('group-dashboard-leave-confirm-btn'));

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('error', 'Failed to leave group');
      });
    });
  });
});
