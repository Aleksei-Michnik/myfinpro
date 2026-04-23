import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateGroupDialog } from './CreateGroupDialog';

const mockCreateGroup = vi.fn();
const mockAddToast = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
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
      'type.family': 'Family',
    };
    return translations[key] || key;
  },
}));

vi.mock('@/lib/group/group-context', () => ({
  useGroups: () => ({
    groups: [],
    isLoading: false,
    fetchGroups: vi.fn(),
    createGroup: mockCreateGroup,
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
  }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

describe('CreateGroupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<CreateGroupDialog isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when isOpen is true', () => {
    render(<CreateGroupDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('create-group-dialog')).toBeInTheDocument();
    expect(screen.getByText('Create New Group')).toBeInTheDocument();
    expect(screen.getByTestId('group-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('group-type-select')).toBeInTheDocument();
    expect(screen.getByTestId('group-currency-select')).toBeInTheDocument();
  });

  it('has create button disabled when name is empty', () => {
    render(<CreateGroupDialog isOpen={true} onClose={vi.fn()} />);
    const btn = screen.getByTestId('confirm-create-group-btn');
    expect(btn).toBeDisabled();
  });

  it('enables create button once name is entered', () => {
    render(<CreateGroupDialog isOpen={true} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('group-name-input'), {
      target: { value: 'My Group' },
    });
    const btn = screen.getByTestId('confirm-create-group-btn');
    expect(btn).not.toBeDisabled();
  });

  it('keeps create button disabled when name is only whitespace', () => {
    render(<CreateGroupDialog isOpen={true} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('group-name-input'), {
      target: { value: '   ' },
    });
    expect(screen.getByTestId('confirm-create-group-btn')).toBeDisabled();
  });

  it('calls createGroup with trimmed name, default type and currency', async () => {
    mockCreateGroup.mockResolvedValueOnce({ id: 'g1', name: 'My Group' });
    const onClose = vi.fn();
    render(<CreateGroupDialog isOpen={true} onClose={onClose} />);

    fireEvent.change(screen.getByTestId('group-name-input'), {
      target: { value: '  My Group  ' },
    });
    fireEvent.click(screen.getByTestId('confirm-create-group-btn'));

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith({
        name: 'My Group',
        type: 'family',
        defaultCurrency: 'USD',
      });
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('success', 'Group created successfully');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('uses selected currency when user changes dropdown', async () => {
    mockCreateGroup.mockResolvedValueOnce({ id: 'g1', name: 'My Group' });
    render(<CreateGroupDialog isOpen={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId('group-name-input'), {
      target: { value: 'My Group' },
    });
    fireEvent.change(screen.getByTestId('group-currency-select'), {
      target: { value: 'ILS' },
    });
    fireEvent.click(screen.getByTestId('confirm-create-group-btn'));

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith(
        expect.objectContaining({ defaultCurrency: 'ILS' }),
      );
    });
  });

  it('shows loading state while submitting', async () => {
    let resolveCreate: (value: unknown) => void;
    mockCreateGroup.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    render(<CreateGroupDialog isOpen={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId('group-name-input'), {
      target: { value: 'My Group' },
    });
    fireEvent.click(screen.getByTestId('confirm-create-group-btn'));

    const btn = screen.getByTestId('confirm-create-group-btn');
    expect(btn).toHaveTextContent('Creating...');
    expect(btn).toBeDisabled();

    resolveCreate!({ id: 'g1', name: 'My Group' });
    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalled();
    });
  });

  it('shows an error toast when createGroup fails', async () => {
    mockCreateGroup.mockRejectedValueOnce(new Error('Server error'));
    const onClose = vi.fn();
    render(<CreateGroupDialog isOpen={true} onClose={onClose} />);

    fireEvent.change(screen.getByTestId('group-name-input'), {
      target: { value: 'My Group' },
    });
    fireEvent.click(screen.getByTestId('confirm-create-group-btn'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'Server error');
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    render(<CreateGroupDialog isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('cancel-create-group-btn'));

    expect(onClose).toHaveBeenCalled();
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });
});
