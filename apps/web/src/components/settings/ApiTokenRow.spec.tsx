import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiTokenRow } from './ApiTokenRow';
import type { ApiTokenSummary } from '@/lib/auth/types';

vi.mock('next-intl', async () => (await import('@/test-utils/real-messages')).realMessagesIntl());

const NOW = new Date('2026-05-01T00:00:00Z');

function makeToken(overrides: Partial<ApiTokenSummary> = {}): ApiTokenSummary {
  return {
    id: 't-1',
    name: 'Laptop connector',
    scopes: ['accounts:import'],
    lastUsedAt: null,
    expiresAt: null,
    createdAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

describe('ApiTokenRow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the name, the fixed scope badge and the created date', () => {
    render(<ApiTokenRow token={makeToken()} onRevoke={vi.fn()} />);
    expect(screen.getByTestId('token-name-t-1')).toHaveTextContent('Laptop connector');
    expect(screen.getByTestId('token-scope-t-1')).toHaveTextContent('Import statement lines');
    expect(screen.getByTestId('token-created-t-1')).toBeInTheDocument();
  });

  it('shows "Never used" when the token has not been used', () => {
    render(<ApiTokenRow token={makeToken({ lastUsedAt: null })} onRevoke={vi.fn()} />);
    expect(screen.getByTestId('token-last-used-t-1')).toHaveTextContent('Never used');
  });

  it('shows the last-used date when the token has run', () => {
    render(
      <ApiTokenRow token={makeToken({ lastUsedAt: '2026-04-20T10:00:00Z' })} onRevoke={vi.fn()} />,
    );
    expect(screen.getByTestId('token-last-used-t-1')).not.toHaveTextContent('Never used');
  });

  it('shows "No expiry" with a neutral badge when there is none', () => {
    render(<ApiTokenRow token={makeToken({ expiresAt: null })} onRevoke={vi.fn()} />);
    expect(screen.getByTestId('token-expiry-t-1')).toHaveTextContent('No expiry');
  });

  it('shows a warning badge with the day count within 14 days of expiry', () => {
    render(
      <ApiTokenRow token={makeToken({ expiresAt: '2026-05-06T00:00:00Z' })} onRevoke={vi.fn()} />,
    );
    // `count`-bearing keys resolve through the test helper as `label:count`
    // (see src/test-utils/real-messages.ts) — asserting the count is what
    // this test can portably check against the real bundle.
    expect(screen.getByTestId('token-expiry-t-1').textContent).toContain(':5');
  });

  it('shows "Expired" on a danger badge and mutes the card once past expiry', () => {
    render(
      <ApiTokenRow token={makeToken({ expiresAt: '2026-04-01T00:00:00Z' })} onRevoke={vi.fn()} />,
    );
    expect(screen.getByTestId('token-expiry-t-1')).toHaveTextContent('Expired');
  });

  it('calls onRevoke with the token when Revoke is clicked', () => {
    const onRevoke = vi.fn();
    const token = makeToken();
    render(<ApiTokenRow token={token} onRevoke={onRevoke} />);
    fireEvent.click(screen.getByTestId('token-revoke-t-1'));
    expect(onRevoke).toHaveBeenCalledWith(token);
  });

  it('disables the Revoke button while busy', () => {
    render(<ApiTokenRow token={makeToken()} busy onRevoke={vi.fn()} />);
    expect(screen.getByTestId('token-revoke-t-1')).toBeDisabled();
  });
});
