import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateApiTokenDialog } from './CreateApiTokenDialog';
import type { ApiTokenCreated } from '@/lib/auth/types';

// Real English messages: a key the bundle lacks renders as its literal path.
vi.mock('next-intl', async () => (await import('@/test-utils/real-messages')).realMessagesIntl());
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

const mockCreateToken = vi.fn();
vi.mock('@/lib/auth/use-api-tokens', () => ({
  useApiTokens: () => ({ createToken: mockCreateToken, listTokens: vi.fn(), revokeToken: vi.fn() }),
}));

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
});

function makeCreated(overrides: Partial<ApiTokenCreated> = {}): ApiTokenCreated {
  return {
    id: 't-1',
    name: 'Laptop connector',
    scopes: ['accounts:import'],
    lastUsedAt: null,
    expiresAt: '2026-08-01T00:00:00Z',
    createdAt: '2026-05-01T00:00:00Z',
    token: 'mfp_secretvalue',
    ...overrides,
  };
}

describe('CreateApiTokenDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the form with every label resolved from the messages bundle', () => {
    render(<CreateApiTokenDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
    const dialog = screen.getByTestId('token-create-dialog');
    expect(screen.getByTestId('token-form-name')).toBeInTheDocument();
    expect(screen.getByTestId('token-form-expiry')).toHaveValue('90');
    expect(screen.getByTestId('token-form-scope')).toHaveTextContent('Import statement lines');
    // No literal key path leaked into the rendered text.
    expect(dialog.textContent).not.toMatch(/settings\.tokens\.[a-zA-Z.]+/);
  });

  it('does not render when closed', () => {
    render(<CreateApiTokenDialog open={false} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.queryByTestId('token-create-dialog')).not.toBeInTheDocument();
  });

  it('shows a validation error and does not submit when the name is empty', () => {
    render(<CreateApiTokenDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByTestId('token-form-submit'));
    expect(screen.getByTestId('token-form-error-name')).toBeInTheDocument();
    expect(mockCreateToken).not.toHaveBeenCalled();
  });

  it('creates a token and reveals it exactly once', async () => {
    const onCreated = vi.fn();
    mockCreateToken.mockResolvedValue(makeCreated());
    render(<CreateApiTokenDialog open onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId('token-form-name'), {
      target: { value: 'Laptop connector' },
    });
    fireEvent.click(screen.getByTestId('token-form-submit'));

    await waitFor(() => expect(screen.getByTestId('token-reveal')).toBeInTheDocument());
    expect(mockCreateToken).toHaveBeenCalledWith(
      { name: 'Laptop connector', expiresAt: expect.any(String) },
      expect.anything(),
    );
    expect(onCreated).toHaveBeenCalledWith(makeCreated());

    const value = screen.getByTestId('token-reveal-value') as HTMLInputElement;
    expect(value.value).toMatch(/^mfp_/);
    expect(screen.getByTestId('token-reveal-commands')).toHaveValue(
      'npx @myfinpro/connector init\nnpx @myfinpro/connector sync',
    );
    expect(screen.getByTestId('token-reveal-warning')).toBeInTheDocument();
    expect(screen.getByTestId('token-reveal-help-link')).toHaveAttribute('href', '/help#connector');

    // Panel A is gone — the form (and the name field) no longer exists.
    expect(screen.queryByTestId('token-form-name')).not.toBeInTheDocument();
  });

  it('Done closes the dialog directly (no confirm)', async () => {
    const onClose = vi.fn();
    mockCreateToken.mockResolvedValue(makeCreated());
    render(<CreateApiTokenDialog open onClose={onClose} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByTestId('token-form-name'), { target: { value: 'Laptop' } });
    fireEvent.click(screen.getByTestId('token-form-submit'));
    await waitFor(() => expect(screen.getByTestId('token-reveal')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('token-reveal-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an accidental close (ESC) after reveal asks for confirmation first', async () => {
    const onClose = vi.fn();
    mockCreateToken.mockResolvedValue(makeCreated());
    render(<CreateApiTokenDialog open onClose={onClose} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByTestId('token-form-name'), { target: { value: 'Laptop' } });
    fireEvent.click(screen.getByTestId('token-form-submit'));
    await waitFor(() => expect(screen.getByTestId('token-reveal')).toBeInTheDocument());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the limit-reached banner and disables the primary on API_TOKEN_LIMIT_REACHED', async () => {
    const err = Object.assign(new Error('Limit reached'), { errorCode: 'API_TOKEN_LIMIT_REACHED' });
    mockCreateToken.mockRejectedValue(err);
    render(<CreateApiTokenDialog open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByTestId('token-form-name'), { target: { value: 'Laptop' } });
    fireEvent.click(screen.getByTestId('token-form-submit'));

    await waitFor(() => expect(screen.getByTestId('token-form-error')).toBeInTheDocument());
    expect(screen.getByTestId('token-form-submit')).toBeDisabled();
  });

  it('shows the generic error banner on any other failure', async () => {
    mockCreateToken.mockRejectedValue(new Error('boom'));
    render(<CreateApiTokenDialog open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByTestId('token-form-name'), { target: { value: 'Laptop' } });
    fireEvent.click(screen.getByTestId('token-form-submit'));

    await waitFor(() => expect(screen.getByTestId('token-form-error')).toBeInTheDocument());
    expect(screen.getByTestId('token-form-submit')).not.toBeDisabled();
  });

  it('sends no expiresAt when the expiry option is "never"', async () => {
    mockCreateToken.mockResolvedValue(makeCreated({ expiresAt: null }));
    render(<CreateApiTokenDialog open onClose={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByTestId('token-form-name'), { target: { value: 'Server' } });
    fireEvent.change(screen.getByTestId('token-form-expiry'), { target: { value: 'never' } });
    fireEvent.click(screen.getByTestId('token-form-submit'));

    await waitFor(() => expect(mockCreateToken).toHaveBeenCalled());
    expect(mockCreateToken.mock.calls[0][0]).toEqual({ name: 'Server', expiresAt: undefined });
  });
});
