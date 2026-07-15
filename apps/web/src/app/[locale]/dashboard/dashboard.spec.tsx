import { act, fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardClient } from './dashboard-client';
import DashboardPage from './page';
import { RealtimeContext } from '@/lib/realtime/realtime-context';

const mockPush = vi.fn();
const totalsMounts = vi.fn();
const scopesMounts = vi.fn();
const recentMounts = vi.fn();
const starredMounts = vi.fn();
let savedHandler: ((p: { id: string }) => void) | null = null;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: {
      id: 'me',
      email: 'me@test.com',
      name: 'Me',
      defaultCurrency: 'USD',
      locale: 'en',
      emailVerified: true,
    },
    accessToken: 'tok',
    getAccessToken: () => 'tok',
  }),
}));

vi.mock('@/components/dashboard/TotalsCard', () => ({
  TotalsCard: () => {
    totalsMounts();
    return <div data-testid="mocked-totals" />;
  },
}));

vi.mock('@/components/dashboard/ScopeEntryCards', () => ({
  ScopeEntryCards: () => {
    scopesMounts();
    return <div data-testid="mocked-scopes" />;
  },
}));

vi.mock('@/components/dashboard/RecentActivity', () => ({
  RecentActivity: () => {
    recentMounts();
    return <div data-testid="mocked-recent" />;
  },
}));

vi.mock('@/components/dashboard/StarredTransactions', () => ({
  StarredTransactions: () => {
    starredMounts();
    return <div data-testid="mocked-starred" />;
  },
}));

vi.mock('@/components/dashboard/QuickAddTransactionButton', () => ({
  QuickAddTransactionButton: ({
    onTransactionCreated,
  }: {
    onTransactionCreated?: (p: { id: string }) => void;
  }) => {
    savedHandler = onTransactionCreated ?? null;
    return (
      <button
        type="button"
        data-testid="mocked-quick-add"
        onClick={() => onTransactionCreated?.({ id: 'created-1' })}
      >
        + Add transaction
      </button>
    );
  },
}));

describe('DashboardPage', () => {
  it('wraps content in ProtectedRoute (renders for authenticated user)', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('dashboard-main')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('renders title and subtitle from i18n', () => {
    render(<DashboardPage />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    // Translation key passthrough via the mocked useTranslations
    expect(screen.getByText('subtitle')).toBeInTheDocument();
  });

  it('renders all four dashboard sections', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('mocked-totals')).toBeInTheDocument();
    expect(screen.getByTestId('mocked-scopes')).toBeInTheDocument();
    expect(screen.getByTestId('mocked-recent')).toBeInTheDocument();
    expect(screen.getByTestId('mocked-starred')).toBeInTheDocument();
  });

  it('renders the QuickAddTransactionButton at the top', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('mocked-quick-add')).toBeInTheDocument();
  });

  it('successful transaction creation re-mounts every section (refreshKey bump)', () => {
    totalsMounts.mockClear();
    scopesMounts.mockClear();
    recentMounts.mockClear();
    starredMounts.mockClear();
    render(<DashboardPage />);
    expect(totalsMounts).toHaveBeenCalledTimes(1);
    expect(scopesMounts).toHaveBeenCalledTimes(1);
    expect(recentMounts).toHaveBeenCalledTimes(1);
    expect(starredMounts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('mocked-quick-add'));

    expect(totalsMounts).toHaveBeenCalledTimes(2);
    expect(scopesMounts).toHaveBeenCalledTimes(2);
    expect(recentMounts).toHaveBeenCalledTimes(2);
    expect(starredMounts).toHaveBeenCalledTimes(2);
  });

  it('refreshKey bump is idempotent across multiple creations', () => {
    totalsMounts.mockClear();
    render(<DashboardPage />);
    fireEvent.click(screen.getByTestId('mocked-quick-add'));
    fireEvent.click(screen.getByTestId('mocked-quick-add'));
    fireEvent.click(screen.getByTestId('mocked-quick-add'));
    // Initial mount + 3 re-mounts = 4
    expect(totalsMounts).toHaveBeenCalledTimes(4);
  });

  it('does not redirect for an authenticated user', () => {
    mockPush.mockClear();
    render(<DashboardPage />);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('quick-add button receives onTransactionCreated handler from the parent', () => {
    render(<DashboardPage />);
    expect(savedHandler).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 6 · 6.18.1.4-hotfix part 2 — dashboard realtime subscription.
// ─────────────────────────────────────────────────────────────────────

type Listener = (event: { type: string; [k: string]: unknown }) => void;
interface Controller {
  emit: (event: { type: string; [k: string]: unknown }) => void;
  setToken: (n: number) => void;
}
function makeController(): Controller {
  return { emit: () => {}, setToken: () => {} };
}

function ProgrammableProvider({
  initialToken = 0,
  controllerRef,
  children,
}: {
  initialToken?: number;
  controllerRef: Controller;
  children: ReactNode;
}) {
  const [token, setToken] = useState(initialToken);
  const [listeners] = useState<Set<Listener>>(() => new Set());
  controllerRef.emit = (event) => {
    for (const l of listeners) l(event);
  };
  controllerRef.setToken = (n) => setToken(n);
  return (
    <RealtimeContext.Provider
      value={{
        connectionStatus: 'connected',
        resyncToken: token,
        subscribe: (l) => {
          listeners.add(l as Listener);
          return () => {
            listeners.delete(l as Listener);
          };
        },
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}

describe('DashboardClient — realtime subscription (Phase 6 · 6.18.1.4-hotfix part 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    totalsMounts.mockClear();
    scopesMounts.mockClear();
    recentMounts.mockClear();
    starredMounts.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces a burst of transaction events into a single refresh after 500 ms', () => {
    const ctrl = makeController();
    render(
      <ProgrammableProvider controllerRef={ctrl}>
        <DashboardClient />
      </ProgrammableProvider>,
    );
    expect(totalsMounts).toHaveBeenCalledTimes(1);

    act(() => {
      ctrl.emit({ type: 'transaction.updated', transaction: { id: 'p1' } });
      ctrl.emit({ type: 'transaction_attribution.removed', transactionId: 'p1' });
      ctrl.emit({ type: 'transaction.created', transaction: { id: 'p1' } });
    });
    // Still no refresh until the debounce window elapses.
    expect(totalsMounts).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(totalsMounts).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(totalsMounts).toHaveBeenCalledTimes(2);
    expect(scopesMounts).toHaveBeenCalledTimes(2);
    expect(recentMounts).toHaveBeenCalledTimes(2);
    expect(starredMounts).toHaveBeenCalledTimes(2);
  });

  it('a single transaction.created event refreshes after the debounce window', () => {
    const ctrl = makeController();
    render(
      <ProgrammableProvider controllerRef={ctrl}>
        <DashboardClient />
      </ProgrammableProvider>,
    );
    expect(totalsMounts).toHaveBeenCalledTimes(1);

    act(() => {
      ctrl.emit({ type: 'transaction.created', transaction: { id: 'p1' } });
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(totalsMounts).toHaveBeenCalledTimes(2);
  });

  it('occurrence.created bumps refreshKey (debounced)', () => {
    const ctrl = makeController();
    render(
      <ProgrammableProvider controllerRef={ctrl}>
        <DashboardClient />
      </ProgrammableProvider>,
    );
    expect(totalsMounts).toHaveBeenCalledTimes(1);

    act(() => {
      ctrl.emit({
        type: 'occurrence.created',
        parentTransactionId: 'p1',
        transaction: { id: 'p2' },
      });
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(totalsMounts).toHaveBeenCalledTimes(2);
  });

  it('comment events do NOT refresh the dashboard', () => {
    const ctrl = makeController();
    render(
      <ProgrammableProvider controllerRef={ctrl}>
        <DashboardClient />
      </ProgrammableProvider>,
    );
    expect(totalsMounts).toHaveBeenCalledTimes(1);

    act(() => {
      ctrl.emit({ type: 'comment.created', transactionId: 'p1', comment: { id: 'c1' } });
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(totalsMounts).toHaveBeenCalledTimes(1);
  });

  it('resyncToken change bumps refreshKey immediately (no debounce)', () => {
    const ctrl = makeController();
    render(
      <ProgrammableProvider initialToken={0} controllerRef={ctrl}>
        <DashboardClient />
      </ProgrammableProvider>,
    );
    expect(totalsMounts).toHaveBeenCalledTimes(1);

    act(() => {
      ctrl.setToken(1);
    });
    // setToken re-renders the provider subtree (render 2), then the
    // resync effect bumps refreshKey → key change remounts the widget
    // (render 3). The remount is what matters: data is refetched.
    expect(totalsMounts).toHaveBeenCalledTimes(3);

    // No further refreshes without another token change — no debounce
    // timer is involved in the resync path.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(totalsMounts).toHaveBeenCalledTimes(3);
  });
});
