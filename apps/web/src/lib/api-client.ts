/**
 * Typed API client for communicating with the NestJS backend.
 *
 * Phase 6 · 6.18.1.4-hotfix — adds a transparent 401-retry interceptor:
 * any request that comes back 401 triggers ONE refresh against
 * `POST /auth/refresh`. While that refresh is in flight, every other
 * 401 awaits the same promise (single-flight de-duplication). On
 * success the retried original request goes out with the new access
 * token; on failure the 401 propagates and the configured
 * `onAuthFailed` hook fires (`auth-context` uses it to log the user
 * out). Successful refreshes broadcast `{ type: 'token-refreshed' }`
 * on `BroadcastChannel('auth')` so other parts of the UI (e.g. the
 * realtime SSE provider) can react without re-implementing the refresh.
 *
 * The auth adapter is configured by `AuthProvider` at runtime — keeping
 * the api-client framework-agnostic and avoiding a circular dependency
 * with `auth-context`.
 */

const getBaseUrl = (): string => {
  // Server-side: use internal URL
  if (typeof window === 'undefined') {
    return process.env.API_INTERNAL_URL || 'http://localhost:3001/api/v1';
  }
  // Client-side: use public URL
  return process.env.NEXT_PUBLIC_API_URL || '/api/v1';
};

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

// ── Auth adapter + 401 interceptor ───────────────────────────────────────

/**
 * Channel name used to fan out token-refresh events between concurrent
 * tabs / contexts in the same browser. Importing this constant from
 * other modules guarantees we never mistype the string.
 */
export const AUTH_BROADCAST_CHANNEL = 'auth';

/** Wire-level message type posted on a successful refresh. */
export const TOKEN_REFRESHED_MESSAGE = 'token-refreshed' as const;

export interface AuthBroadcastMessage {
  type: typeof TOKEN_REFRESHED_MESSAGE;
  /**
   * The fresh access token, mirrored on the channel so other tabs can
   * adopt it without issuing their own refresh. Refresh-token cookies
   * are HttpOnly and remain server-managed.
   */
  accessToken: string;
}

export interface ApiAuthAdapter {
  getAccessToken(): string | null;
  /** Called after a successful refresh — store the new token in state + storage. */
  setAccessToken(token: string): void;
  /** Called when refresh fails (network or 401) — typically triggers logout. */
  onAuthFailed(): void;
}

let authAdapter: ApiAuthAdapter | null = null;
let inFlightRefresh: Promise<string | null> | null = null;

/**
 * Wire (or unwire) the auth adapter. Called from `AuthProvider` on
 * mount; passing `null` on unmount keeps tests deterministic.
 */
export function configureApiAuth(adapter: ApiAuthAdapter | null): void {
  authAdapter = adapter;
}

function postTokenRefreshedBroadcast(accessToken: string): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
    const message: AuthBroadcastMessage = { type: TOKEN_REFRESHED_MESSAGE, accessToken };
    channel.postMessage(message);
    channel.close();
  } catch {
    // BroadcastChannel may not exist in some embedded webviews — fail
    // open; the in-tab refresh path still works.
  }
}

/**
 * Single-flight refresh. Concurrent 401s all await the same promise.
 * Resolves to the new access token (string) on success, `null` on
 * failure.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (!authAdapter) return null;
  if (inFlightRefresh) return inFlightRefresh;

  const refreshUrl = `${getBaseUrl()}/auth/refresh`;
  inFlightRefresh = (async () => {
    try {
      const res = await fetch(refreshUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        authAdapter?.onAuthFailed();
        return null;
      }
      const body = (await res.json().catch(() => null)) as {
        accessToken?: string;
      } | null;
      const newToken = body?.accessToken ?? null;
      if (!newToken) {
        authAdapter?.onAuthFailed();
        return null;
      }
      authAdapter?.setAccessToken(newToken);
      postTokenRefreshedBroadcast(newToken);
      return newToken;
    } catch {
      authAdapter?.onAuthFailed();
      return null;
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

/** Test-only — reset the in-flight cache between tests. Not for product code. */
export function __resetApiAuthForTests(): void {
  authAdapter = null;
  inFlightRefresh = null;
}

/** Endpoints that must never trigger a refresh (would loop). */
function isAuthEndpoint(url: string): boolean {
  return /\/auth\/(refresh|login|register|logout)(\?|$|\/)/.test(url);
}

interface ApiFetchOptions extends RequestInit {
  /**
   * Skip the automatic Bearer header (used internally for the refresh
   * call itself).
   */
  skipAuthHeader?: boolean;
  /** Skip the 401 retry. Used internally and by callers that opt out. */
  skipAuthRetry?: boolean;
}

/**
 * Single fetch primitive used by `ApiClient` and by callers that need
 * the 401-retry behaviour without going through the typed wrapper.
 * Always sends `credentials: 'include'` so the refresh cookie is
 * available on every request.
 */
export async function apiFetch(input: string, init: ApiFetchOptions = {}): Promise<Response> {
  const url = input.startsWith('http') ? input : `${getBaseUrl()}${input}`;
  const { skipAuthHeader, skipAuthRetry, headers, credentials, ...rest } = init;

  const buildHeaders = (): HeadersInit => {
    const merged = new Headers(headers);
    if (!skipAuthHeader && authAdapter && !merged.has('Authorization')) {
      const token = authAdapter.getAccessToken();
      if (token) merged.set('Authorization', `Bearer ${token}`);
    }
    return merged;
  };

  const doFetch = (): Promise<Response> =>
    fetch(url, {
      ...rest,
      credentials: credentials ?? 'include',
      headers: buildHeaders(),
    });

  let response = await doFetch();

  if (response.status === 401 && !skipAuthRetry && !isAuthEndpoint(url) && authAdapter) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      // Retry once with the freshly-refreshed token.
      response = await doFetch();
    }
  }

  return response;
}

class ApiClient {
  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { body, headers, ...rest } = options;

    const response = await apiFetch(endpoint, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error((errorBody as { message?: string }).message || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  async put<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body });
  }

  async patch<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body });
  }

  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
