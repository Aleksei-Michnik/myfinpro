import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemberManagement } from './MemberManagement';
import type { GroupDetail } from '@/lib/group/types';

const mockUpdateMemberRole = vi.fn();
const mockRemoveMember = vi.fn();
const mockAddToast = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === 'removeConfirmMessage' && values?.name !== undefined) {
      return `Are you sure you want to remove ${values.name} from this group?`;
    }
    const translations: Record<string, string> = {
      roleLabel: 'Role',
      admin: 'Admin',
      member: 'Member',
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
    };
    return translations[key] || key;
  },
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({
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

const sampleGroup: GroupDetail = {
  id: 'group-1',
  name: 'The Smiths',
  type: 'family',
  defaultCurrency: 'USD',
  createdById: 'user-1',
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
  memberCount: 3,
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
      role: 'member',
      joinedAt: '2026-04-05T00:00:00Z',
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

function makeApiError(errorCode: string, message = 'error'): Error & { errorCode?: string } {
  return Object.assign(new Error(message), { errorCode });
}

describe('MemberManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all members', () => {
    render(<MemberManagement group={sampleGroup} currentUserId="user-1" />);
    expect(screen.getByTestId('member-row-user-1')).toBeInTheDocument();
    expect(screen.getByTestId('member-row-user-2')).toBeInTheDocument();
    expect(screen.getByTestId('member-row-user-3')).toBeInTheDocument();
  });

  it('disables role select and remove button for the current user', () => {
    render(<MemberManagement group={sampleGroup} currentUserId="user-1" />);
    const roleSelect = screen.getByTestId('role-select-user-1') as HTMLSelectElement;
    const removeBtn = screen.getByTestId('remove-member-btn-user-1') as HTMLButtonElement;

    expect(roleSelect).toBeDisabled();
    expect(removeBtn).toBeDisabled();
  });

  it('enables controls for other members', () => {
    render(<MemberManagement group={sampleGroup} currentUserId="user-1" />);
    const roleSelect = screen.getByTestId('role-select-user-2') as HTMLSelectElement;
    const removeBtn = screen.getByTestId('remove-member-btn-user-2') as HTMLButtonElement;

    expect(roleSelect).not.toBeDisabled();
    expect(removeBtn).not.toBeDisabled();
  });

  it('calls updateMemberRole and shows success toast on role change', async () => {
    mockUpdateMemberRole.mockResolvedValue(undefined);
    const onChanged = vi.fn();

    render(<MemberManagement group={sampleGroup} currentUserId="user-1" onChanged={onChanged} />);

    const roleSelect = screen.getByTestId('role-select-user-2') as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'admin' } });

    await waitFor(() => {
      expect(mockUpdateMemberRole).toHaveBeenCalledWith('group-1', 'user-2', 'admin');
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Role updated');
    });

    expect(onChanged).toHaveBeenCalled();
  });

  it('shows localized error on CANNOT_REMOVE_LAST_ADMIN on role change', async () => {
    mockUpdateMemberRole.mockRejectedValue(makeApiError('GROUP_CANNOT_REMOVE_LAST_ADMIN'));

    render(<MemberManagement group={sampleGroup} currentUserId="user-1" />);

    const roleSelect = screen.getByTestId('role-select-user-3') as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'member' } });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'Cannot remove the last admin');
    });
  });

  it('opens confirmation dialog when clicking remove', () => {
    render(<MemberManagement group={sampleGroup} currentUserId="user-1" />);

    expect(screen.queryByTestId('remove-member-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('remove-member-btn-user-2'));

    expect(screen.getByTestId('remove-member-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('remove-member-dialog')).toHaveTextContent(
      'Are you sure you want to remove Bob from this group?',
    );
  });

  it('closes dialog on cancel', () => {
    render(<MemberManagement group={sampleGroup} currentUserId="user-1" />);
    fireEvent.click(screen.getByTestId('remove-member-btn-user-2'));
    expect(screen.getByTestId('remove-member-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('remove-member-cancel-btn'));

    expect(screen.queryByTestId('remove-member-dialog')).not.toBeInTheDocument();
  });

  it('calls removeMember and shows success toast on confirm', async () => {
    mockRemoveMember.mockResolvedValue(undefined);
    const onChanged = vi.fn();

    render(<MemberManagement group={sampleGroup} currentUserId="user-1" onChanged={onChanged} />);

    fireEvent.click(screen.getByTestId('remove-member-btn-user-2'));
    fireEvent.click(screen.getByTestId('remove-member-confirm-btn'));

    await waitFor(() => {
      expect(mockRemoveMember).toHaveBeenCalledWith('group-1', 'user-2');
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Member removed');
    });

    expect(onChanged).toHaveBeenCalled();

    // Dialog closed
    await waitFor(() => {
      expect(screen.queryByTestId('remove-member-dialog')).not.toBeInTheDocument();
    });
  });

  it('shows localized error on CANNOT_REMOVE_LAST_ADMIN on remove', async () => {
    mockRemoveMember.mockRejectedValue(makeApiError('GROUP_CANNOT_REMOVE_LAST_ADMIN'));

    render(<MemberManagement group={sampleGroup} currentUserId="user-1" />);

    fireEvent.click(screen.getByTestId('remove-member-btn-user-3'));
    fireEvent.click(screen.getByTestId('remove-member-confirm-btn'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'Cannot remove the last admin');
    });
  });

  it('shows localized error on NOT_A_MEMBER on remove', async () => {
    mockRemoveMember.mockRejectedValue(makeApiError('GROUP_NOT_A_MEMBER'));

    render(<MemberManagement group={sampleGroup} currentUserId="user-1" />);

    fireEvent.click(screen.getByTestId('remove-member-btn-user-2'));
    fireEvent.click(screen.getByTestId('remove-member-confirm-btn'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'User is no longer a member');
    });
  });

  it('shows localized error on CANNOT_REMOVE_SELF on remove', async () => {
    mockRemoveMember.mockRejectedValue(makeApiError('GROUP_CANNOT_REMOVE_SELF'));

    render(<MemberManagement group={sampleGroup} currentUserId="user-1" />);

    fireEvent.click(screen.getByTestId('remove-member-btn-user-2'));
    fireEvent.click(screen.getByTestId('remove-member-confirm-btn'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'error',
        "You can't remove yourself — use leave group instead",
      );
    });
  });

  it('shows generic error on unknown error code', async () => {
    mockRemoveMember.mockRejectedValue(new Error('Network'));

    render(<MemberManagement group={sampleGroup} currentUserId="user-1" />);

    fireEvent.click(screen.getByTestId('remove-member-btn-user-2'));
    fireEvent.click(screen.getByTestId('remove-member-confirm-btn'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'Operation failed');
    });
  });
});
