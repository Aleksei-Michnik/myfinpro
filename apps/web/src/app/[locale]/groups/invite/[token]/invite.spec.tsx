import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import InvitePage from './page';
import type { GroupSummary, InviteInfo } from '@/lib/group/types';

const mockPush = vi.fn();
const mockAddToast = vi.fn();

let mockGroupState: {
  groups: GroupSummary[];
  isLoading: boolean;
  fetchGroups: ReturnType<typeof vi.fn>;
  createGroup: ReturnType<typeof vi.fn>;
  updateGroup: ReturnType<typeof vi.fn>;
  deleteGroup: ReturnType<typeof vi.fn>;
  getInviteInfo: ReturnType<typeof vi.fn>;
  acceptInvite: ReturnType<typeof vi.fn>;
};

let mockParamsToken: string | string[] | undefined = 'valid-token';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      'invite.title': "You've been invited",
      'invite.joinMessage': "You've been invited to join",
      'invite.accept': 'Accept & Join',
      'invite.accepting': 'Joining...',
      'invite.decline': 'Decline',
      'invite.alreadyMember': "You're already a member of this group",
      'invite.goToGroups': 'Go to Groups',
      'invite.loading': 'Loading invite...',
      'invite.error.invalid': 'This invite link is not valid',
      'invite.error.expired': 'This invite has expired',
      'invite.error.used': 'This invite has already been used',
      'invite.error.generic': 'Unable to load invite',
      'type.family': 'Family',
    };
    if (key === 'invite.invitedBy' && values?.name !== undefined) {
      return `Invited by ${values.name}`;
    }
    if (key === 'invite.acceptSuccess' && values?.name !== undefined) {
      return `You've joined ${values.name}`;
    }
    return translations[key] || key;
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: mockParamsToken }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  usePathname: () => '/groups/invite/valid-token',
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
    accessToken: 'mock-token',
    getAccessToken: () => 'mock-token',
  }),
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => mockGroupState,
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

const sampleInvite: InviteInfo = {
  groupId: 'group-1',
  groupName: 'The Smiths',
  groupType: 'family',
  inviterName: 'Alice',
};

const sampleGroup: GroupSummary = {
  id: 'group-1',
  name: 'The Smiths',
  type: 'family',
  defaultCurrency: 'USD',
  createdById: 'user-2',
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
  memberCount: 3,
  role: 'member',
};

function makeApiError(errorCode: string, message = 'error'): Error & { errorCode?: string } {
  return Object.assign(new Error(message), { errorCode });
}

describe('InvitePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockParamsToken = 'valid-token';
    mockGroupState = {
      groups: [],
      isLoading: false,
      fetchGroups: vi.fn(),
      createGroup: vi.fn(),
      updateGroup: vi.fn(),
      deleteGroup: vi.fn(),
      // Default: never resolves so the test sees the loading state.
      getInviteInfo: vi.fn(() => new Promise(() => {})),
      acceptInvite: vi.fn(),
    };
  });

  it('renders the loading skeleton while fetching invite info', () => {
    render(<InvitePage />);
    expect(screen.getByTestId('invite-loading')).toBeInTheDocument();
  });

  it('renders the invite info after load (group name, type, inviter)', async () => {
    mockGroupState.getInviteInfo = vi.fn().mockResolvedValue(sampleInvite);

    render(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByTestId('invite-card')).toBeInTheDocument();
    });

    expect(screen.getByTestId('invite-group-name')).toHaveTextContent('The Smiths');
    expect(screen.getByTestId('invite-group-type')).toHaveTextContent('Family');
    expect(screen.getByTestId('invite-inviter')).toHaveTextContent('Invited by Alice');
    expect(screen.getByTestId('invite-accept-btn')).toBeInTheDocument();
    expect(screen.getByTestId('invite-decline-btn')).toBeInTheDocument();
  });

  it('shows error card for an invalid token', async () => {
    mockGroupState.getInviteInfo = vi
      .fn()
      .mockRejectedValue(makeApiError('GROUP_INVITE_TOKEN_INVALID'));

    render(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByTestId('invite-error')).toBeInTheDocument();
    });

    expect(screen.getByTestId('invite-error-title')).toHaveTextContent(
      'This invite link is not valid',
    );
    expect(screen.getByTestId('invite-go-to-groups-btn')).toBeInTheDocument();
  });

  it('shows error card for an expired token', async () => {
    mockGroupState.getInviteInfo = vi
      .fn()
      .mockRejectedValue(makeApiError('GROUP_INVITE_TOKEN_EXPIRED'));

    render(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByTestId('invite-error')).toBeInTheDocument();
    });

    expect(screen.getByTestId('invite-error-title')).toHaveTextContent('This invite has expired');
  });

  it('shows error card for an already-used token', async () => {
    mockGroupState.getInviteInfo = vi
      .fn()
      .mockRejectedValue(makeApiError('GROUP_INVITE_TOKEN_USED'));

    render(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByTestId('invite-error')).toBeInTheDocument();
    });

    expect(screen.getByTestId('invite-error-title')).toHaveTextContent(
      'This invite has already been used',
    );
  });

  it('shows a generic error card for unknown errors', async () => {
    mockGroupState.getInviteInfo = vi.fn().mockRejectedValue(new Error('Network error'));

    render(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByTestId('invite-error')).toBeInTheDocument();
    });

    expect(screen.getByTestId('invite-error-title')).toHaveTextContent('Unable to load invite');
  });

  it('navigates to /groups when clicking "Go to Groups" on error card', async () => {
    mockGroupState.getInviteInfo = vi
      .fn()
      .mockRejectedValue(makeApiError('GROUP_INVITE_TOKEN_INVALID'));

    render(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByTestId('invite-go-to-groups-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('invite-go-to-groups-btn'));

    expect(mockPush).toHaveBeenCalledWith('/groups');
  });

  it('calls acceptInvite and navigates to the group on success', async () => {
    mockGroupState.getInviteInfo = vi.fn().mockResolvedValue(sampleInvite);
    mockGroupState.acceptInvite = vi.fn().mockResolvedValue(sampleGroup);

    render(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByTestId('invite-accept-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('invite-accept-btn'));

    await waitFor(() => {
      expect(mockGroupState.acceptInvite).toHaveBeenCalledWith('valid-token');
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/groups/group-1');
    });

    expect(mockAddToast).toHaveBeenCalledWith('success', "You've joined The Smiths");
  });

  it('shows "already member" toast and navigates on ALREADY_A_MEMBER error', async () => {
    vi.useFakeTimers();
    mockGroupState.getInviteInfo = vi.fn().mockResolvedValue(sampleInvite);
    mockGroupState.acceptInvite = vi.fn().mockRejectedValue(makeApiError('GROUP_ALREADY_A_MEMBER'));

    render(<InvitePage />);

    // Flush the getInviteInfo microtask
    await act(async () => {
      await Promise.resolve();
    });

    const acceptBtn = screen.getByTestId('invite-accept-btn');
    fireEvent.click(acceptBtn);

    // Allow the acceptInvite rejection to be handled
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockAddToast).toHaveBeenCalledWith('info', "You're already a member of this group");

    // Advance the 1500ms delay
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(mockPush).toHaveBeenCalledWith('/groups/group-1');
    vi.useRealTimers();
  });

  it('shows error toast and re-enables the button on non-member errors', async () => {
    mockGroupState.getInviteInfo = vi.fn().mockResolvedValue(sampleInvite);
    mockGroupState.acceptInvite = vi
      .fn()
      .mockRejectedValue(makeApiError('GROUP_INVITE_TOKEN_EXPIRED'));

    render(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByTestId('invite-accept-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('invite-accept-btn'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'This invite has expired');
    });

    // Button should be re-enabled
    expect(screen.getByTestId('invite-accept-btn')).not.toBeDisabled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('navigates to /groups when clicking Decline', async () => {
    mockGroupState.getInviteInfo = vi.fn().mockResolvedValue(sampleInvite);

    render(<InvitePage />);

    await waitFor(() => {
      expect(screen.getByTestId('invite-decline-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('invite-decline-btn'));

    expect(mockPush).toHaveBeenCalledWith('/groups');
  });
});
