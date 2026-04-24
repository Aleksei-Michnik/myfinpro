import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GroupSettingsPage from './page';
import type { GroupDetail } from '@/lib/group/types';

const mockPush = vi.fn();
const mockAddToast = vi.fn();
const mockGetGroup = vi.fn();
const mockUpdateGroup = vi.fn();
const mockDeleteGroup = vi.fn();
const mockCreateInvite = vi.fn();
const mockUpdateMemberRole = vi.fn();
const mockRemoveMember = vi.fn();

let mockParamsGroupId: string | string[] | undefined = 'group-1';
let mockCurrentUser: { id: string; email: string; name: string } | null = {
  id: 'user-1',
  email: 'alice@test.com',
  name: 'Alice',
};

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === 'members.title' && values?.count !== undefined) {
      return `Manage Members (${values.count})`;
    }
    if (key === 'dangerZone.dialogTitle' && values?.name !== undefined) {
      return `Delete ${values.name}?`;
    }
    if (key === 'removeConfirmMessage' && values?.name !== undefined) {
      return `Remove ${values.name}?`;
    }
    if (key === 'expiresOn' && values?.date !== undefined) {
      return `Link expires on ${values.date}`;
    }
    const translations: Record<string, string> = {
      title: 'Group Settings',
      loading: 'Loading group settings...',
      noPermission: "You don't have permission to access group settings",
      backToGroup: 'Back to Group',
      backToGroups: 'Back to Groups',
      'info.title': 'Group Information',
      'info.nameLabel': 'Group Name',
      'info.typeLabel': 'Type',
      'info.currencyLabel': 'Default Currency',
      'info.saveButton': 'Save Changes',
      'info.saving': 'Saving...',
      'info.saveSuccess': 'Group updated',
      'info.saveError': 'Failed to update group',
      'invite.title': 'Invite Members',
      'invite.description':
        'Generate a shareable invite link. Anyone with the link can join this group.',
      'invite.generateButton': 'Generate Invite Link',
      'invite.generating': 'Generating...',
      'invite.copyButton': 'Copy',
      'invite.copied': 'Link copied to clipboard',
      'invite.linkLabel': 'Invite Link',
      'invite.regenerateButton': 'Generate new link',
      'invite.error': 'Failed to generate invite',
      'members.roleLabel': 'Role',
      'members.admin': 'Admin',
      'members.member': 'Member',
      'members.removeButton': 'Remove',
      'members.removeConfirmTitle': 'Remove member',
      'members.removeConfirmButton': 'Remove',
      'members.cancelButton': 'Cancel',
      'members.roleChangeSuccess': 'Role updated',
      'members.removeSuccess': 'Member removed',
      'members.errors.cannotRemoveLastAdmin': 'Cannot remove the last admin',
      'members.errors.cannotRemoveSelf': "You can't remove yourself — use leave group instead",
      'members.errors.notAMember': 'User is no longer a member',
      'members.errors.generic': 'Operation failed',
      'dangerZone.title': 'Danger Zone',
      'dangerZone.deleteHeading': 'Delete Group',
      'dangerZone.deleteDescription':
        'Permanently delete this group and all of its data. This cannot be undone.',
      'dangerZone.deleteButton': 'Delete Group',
      'dangerZone.dialogMessage':
        'This will permanently delete the group and all its data. Type the group name to confirm.',
      'dangerZone.dialogInputPlaceholder': 'Type group name',
      'dangerZone.dialogConfirmButton': 'Delete permanently',
      'dangerZone.dialogCancelButton': 'Cancel',
      'dangerZone.mismatchError': 'Group name does not match',
      'dangerZone.deleteSuccess': 'Group deleted',
      'dangerZone.deleteError': 'Failed to delete group',
      'dashboard.notFound': "Group not found or you don't have access",
      'type.family': 'Family',
      admin: 'Admin',
      member: 'Member',
      roleLabel: 'Role',
      removeButton: 'Remove',
      removeConfirmTitle: 'Remove member',
      removeConfirmButton: 'Remove',
      cancelButton: 'Cancel',
      roleChangeSuccess: 'Role updated',
      removeSuccess: 'Member removed',
      'errors.cannotRemoveLastAdmin': 'Cannot remove the last admin',
      'errors.cannotRemoveSelf': "You can't remove yourself — use leave group instead",
      'errors.notAMember': 'User is no longer a member',
      'errors.generic': 'Operation failed',
      description: 'Generate a shareable invite link. Anyone with the link can join this group.',
      generateButton: 'Generate Invite Link',
      generating: 'Generating...',
      copyButton: 'Copy',
      copied: 'Link copied to clipboard',
      linkLabel: 'Invite Link',
      regenerateButton: 'Generate new link',
      error: 'Failed to generate invite',
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
  usePathname: () => '/groups/group-1/settings',
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock('@/components/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: mockCurrentUser,
    accessToken: 'mock-token',
    getAccessToken: () => 'mock-token',
  }),
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({
    groups: [],
    isLoading: false,
    fetchGroups: vi.fn(),
    getGroup: mockGetGroup,
    refreshGroup: mockGetGroup,
    createGroup: vi.fn(),
    updateGroup: mockUpdateGroup,
    deleteGroup: mockDeleteGroup,
    getInviteInfo: vi.fn(),
    acceptInvite: vi.fn(),
    createInvite: mockCreateInvite,
    updateMemberRole: mockUpdateMemberRole,
    removeMember: mockRemoveMember,
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

const adminGroup: GroupDetail = {
  id: 'group-1',
  name: 'The Smiths',
  type: 'family',
  defaultCurrency: 'USD',
  createdById: 'user-1',
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
  memberCount: 2,
  role: 'admin',
  members: [
    {
      id: 'user-1',
      name: 'Alice',
      email: 'alice@test.com',
      role: 'admin',
      joinedAt: '2026-04-01T00:00:00Z',
    },
    {
      id: 'user-2',
      name: 'Bob',
      email: 'bob@test.com',
      role: 'admin',
      joinedAt: '2026-04-02T00:00:00Z',
    },
  ],
};

const memberOnlyGroup: GroupDetail = {
  ...adminGroup,
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

describe('GroupSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParamsGroupId = 'group-1';
    mockCurrentUser = { id: 'user-1', email: 'alice@test.com', name: 'Alice' };
    // Default: never resolves
    mockGetGroup.mockImplementation(() => new Promise(() => {}));
  });

  it('renders loading skeleton while fetching the group', () => {
    render(<GroupSettingsPage />);
    expect(screen.getByTestId('group-settings-loading')).toBeInTheDocument();
  });

  it('renders no-permission card when user is not an admin', async () => {
    mockGetGroup.mockResolvedValue(memberOnlyGroup);

    render(<GroupSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-settings-no-permission')).toBeInTheDocument();
    });

    expect(screen.getByTestId('group-settings-back-to-group-btn')).toHaveAttribute(
      'href',
      '/groups/group-1',
    );
  });

  it('renders error card when the group fails to load', async () => {
    mockGetGroup.mockRejectedValue(new Error('Not found'));

    render(<GroupSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-settings-error')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('group-settings-back-to-groups-btn'));
    expect(mockPush).toHaveBeenCalledWith('/groups');
  });

  it('renders all sections for an admin', async () => {
    mockGetGroup.mockResolvedValue(adminGroup);

    render(<GroupSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-settings-info')).toBeInTheDocument();
    });

    expect(screen.getByTestId('group-settings-invite-section')).toBeInTheDocument();
    expect(screen.getByTestId('group-settings-members-section')).toBeInTheDocument();
    expect(screen.getByTestId('group-settings-danger-zone')).toBeInTheDocument();
  });

  it('prefills the info form with current group values', async () => {
    mockGetGroup.mockResolvedValue(adminGroup);

    render(<GroupSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-settings-name-input')).toBeInTheDocument();
    });

    const nameInput = screen.getByTestId('group-settings-name-input') as HTMLInputElement;
    expect(nameInput.value).toBe('The Smiths');
  });

  it('calls updateGroup when saving and shows a success toast', async () => {
    mockGetGroup
      .mockResolvedValueOnce(adminGroup)
      .mockResolvedValueOnce({ ...adminGroup, name: 'Smiths Family' });
    mockUpdateGroup.mockResolvedValue({ ...adminGroup, name: 'Smiths Family' });

    render(<GroupSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-settings-name-input')).toBeInTheDocument();
    });

    const nameInput = screen.getByTestId('group-settings-name-input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Smiths Family' } });
    fireEvent.click(screen.getByTestId('group-settings-save-btn'));

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith('group-1', {
        name: 'Smiths Family',
        type: 'family',
        defaultCurrency: 'USD',
      });
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Group updated');
    });
  });

  it('opens the delete dialog and disables confirm until name matches', async () => {
    mockGetGroup.mockResolvedValue(adminGroup);

    render(<GroupSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-settings-open-delete-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('group-settings-open-delete-btn'));

    expect(screen.getByTestId('group-settings-delete-dialog')).toBeInTheDocument();
    const confirmBtn = screen.getByTestId('group-settings-delete-confirm-btn') as HTMLButtonElement;
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByTestId('group-settings-delete-confirm-input') as HTMLInputElement;

    // Mismatch
    fireEvent.change(input, { target: { value: 'wrong' } });
    expect(confirmBtn).toBeDisabled();
    expect(screen.getByTestId('group-settings-delete-mismatch')).toBeInTheDocument();

    // Match
    fireEvent.change(input, { target: { value: 'The Smiths' } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it('calls deleteGroup and navigates on confirm', async () => {
    mockGetGroup.mockResolvedValue(adminGroup);
    mockDeleteGroup.mockResolvedValue(undefined);

    render(<GroupSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('group-settings-open-delete-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('group-settings-open-delete-btn'));
    const input = screen.getByTestId('group-settings-delete-confirm-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'The Smiths' } });

    fireEvent.click(screen.getByTestId('group-settings-delete-confirm-btn'));

    await waitFor(() => {
      expect(mockDeleteGroup).toHaveBeenCalledWith('group-1');
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Group deleted');
    });
    expect(mockPush).toHaveBeenCalledWith('/groups');
  });

  it('renders the invite generate button', async () => {
    mockGetGroup.mockResolvedValue(adminGroup);

    render(<GroupSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('generate-invite-btn')).toBeInTheDocument();
    });
  });

  it('renders members in the members section', async () => {
    mockGetGroup.mockResolvedValue(adminGroup);

    render(<GroupSettingsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('member-row-user-1')).toBeInTheDocument();
    });

    expect(screen.getByTestId('member-row-user-2')).toBeInTheDocument();
  });
});
