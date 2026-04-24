import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InviteLink } from './InviteLink';

const mockCreateInvite = vi.fn();
const mockAddToast = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === 'expiresOn' && values?.date !== undefined) {
      return `Link expires on ${values.date}`;
    }
    const translations: Record<string, string> = {
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

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({
    createInvite: mockCreateInvite,
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

describe('InviteLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default clipboard mock
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders the generate button initially', () => {
    render(<InviteLink groupId="group-1" />);
    expect(screen.getByTestId('generate-invite-btn')).toBeInTheDocument();
    expect(screen.getByTestId('generate-invite-btn')).toHaveTextContent('Generate Invite Link');
    expect(screen.getByTestId('invite-description')).toBeInTheDocument();
  });

  it('calls createInvite and displays the URL on success', async () => {
    const expiresAt = '2026-05-01T12:00:00Z';
    mockCreateInvite.mockResolvedValue({
      token: 'raw-token',
      expiresAt,
      inviteUrl: 'https://example.test/groups/invite/raw-token',
    });

    render(<InviteLink groupId="group-1" />);
    fireEvent.click(screen.getByTestId('generate-invite-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('invite-result')).toBeInTheDocument();
    });

    expect(mockCreateInvite).toHaveBeenCalledWith('group-1');
    const input = screen.getByTestId('invite-url-input') as HTMLInputElement;
    expect(input.value).toBe('https://example.test/groups/invite/raw-token');
    expect(screen.getByTestId('copy-invite-btn')).toBeInTheDocument();
    expect(screen.getByTestId('regenerate-invite-btn')).toBeInTheDocument();
    expect(screen.getByTestId('invite-expires')).toHaveTextContent(/Link expires on/);
  });

  it('copies the invite URL to clipboard on copy click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    mockCreateInvite.mockResolvedValue({
      token: 'raw-token',
      expiresAt: '2026-05-01T12:00:00Z',
      inviteUrl: 'https://example.test/groups/invite/raw-token',
    });

    render(<InviteLink groupId="group-1" />);
    fireEvent.click(screen.getByTestId('generate-invite-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('copy-invite-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('copy-invite-btn'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://example.test/groups/invite/raw-token');
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Link copied to clipboard');
    });
  });

  it('shows error toast when generation fails', async () => {
    mockCreateInvite.mockRejectedValue(new Error('boom'));

    render(<InviteLink groupId="group-1" />);
    fireEvent.click(screen.getByTestId('generate-invite-btn'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'boom');
    });

    // Still on the generate button (no invite-result)
    expect(screen.queryByTestId('invite-result')).not.toBeInTheDocument();
  });

  it('falls back to selecting input when clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    mockCreateInvite.mockResolvedValue({
      token: 'raw-token',
      expiresAt: '2026-05-01T12:00:00Z',
      inviteUrl: 'https://example.test/groups/invite/raw-token',
    });

    render(<InviteLink groupId="group-1" />);
    fireEvent.click(screen.getByTestId('generate-invite-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('copy-invite-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('copy-invite-btn'));

    // Still shows info toast
    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalled();
    });
    const call = mockAddToast.mock.calls[mockAddToast.mock.calls.length - 1];
    expect(call[1]).toBe('Link copied to clipboard');
  });

  it('regenerates the invite when clicking the regenerate button', async () => {
    mockCreateInvite
      .mockResolvedValueOnce({
        token: 'token-1',
        expiresAt: '2026-05-01T12:00:00Z',
        inviteUrl: 'https://example.test/groups/invite/token-1',
      })
      .mockResolvedValueOnce({
        token: 'token-2',
        expiresAt: '2026-05-02T12:00:00Z',
        inviteUrl: 'https://example.test/groups/invite/token-2',
      });

    render(<InviteLink groupId="group-1" />);
    fireEvent.click(screen.getByTestId('generate-invite-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('invite-url-input')).toHaveValue(
        'https://example.test/groups/invite/token-1',
      );
    });

    fireEvent.click(screen.getByTestId('regenerate-invite-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('invite-url-input')).toHaveValue(
        'https://example.test/groups/invite/token-2',
      );
    });

    expect(mockCreateInvite).toHaveBeenCalledTimes(2);
  });
});
