import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to re-import the module in some tests to test constructor behavior,
// so we use dynamic imports with module reset.

const mockFetch = vi.fn();
global.fetch = mockFetch;

function createJsonResponse(body: unknown, status = 200, ok = true): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

/**
 * The interceptor sends headers as a `Headers` instance. Normalise to a
 * plain record so assertions read more naturally and survive future
 * format tweaks. Phase 6 · 6.18.1.4-hotfix.
 */
function readHeaders(call: unknown[]): Record<string, string> {
  const opts = call[1] as { headers?: HeadersInit };
  if (!opts?.headers) return {};
  if (opts.headers instanceof Headers) {
    const out: Record<string, string> = {};
    opts.headers.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(opts.headers)) {
    return Object.fromEntries(opts.headers.map(([k, v]) => [k.toLowerCase(), v]));
  }
  const rec = opts.headers as Record<string, string>;
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k.toLowerCase(), v]));
}

describe('ApiClient', () => {
  let apiClient: typeof import('./api-client').apiClient;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    // Default: simulate client-side (window is defined in jsdom)
    const mod = await import('./api-client');
    apiClient = mod.apiClient;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('get()', () => {
    it('makes a GET request to the correct URL', async () => {
      mockFetch.mockResolvedValue(createJsonResponse({ data: 'test' }));

      const result = await apiClient.get('/users');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/users');
      expect(options.method).toBe('GET');
      expect(result).toEqual({ data: 'test' });
    });
  });

  describe('post()', () => {
    it('sends JSON body with POST method', async () => {
      const requestBody = { name: 'John', email: 'john@test.com' };
      mockFetch.mockResolvedValue(createJsonResponse({ id: 1 }));

      const result = await apiClient.post('/users', requestBody);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify(requestBody));
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('put()', () => {
    it('sends PUT request with body', async () => {
      const requestBody = { name: 'Updated' };
      mockFetch.mockResolvedValue(createJsonResponse({ success: true }));

      await apiClient.put('/users/1', requestBody);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('PUT');
      expect(options.body).toBe(JSON.stringify(requestBody));
    });
  });

  describe('patch()', () => {
    it('sends PATCH request with body', async () => {
      const requestBody = { name: 'Patched' };
      mockFetch.mockResolvedValue(createJsonResponse({ success: true }));

      await apiClient.patch('/users/1', requestBody);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe('PATCH');
      expect(options.body).toBe(JSON.stringify(requestBody));
    });
  });

  describe('delete()', () => {
    it('sends DELETE request', async () => {
      mockFetch.mockResolvedValue(createJsonResponse({ deleted: true }));

      const result = await apiClient.delete('/users/1');

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/users/1');
      expect(options.method).toBe('DELETE');
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('error handling', () => {
    it('throws Error with message from JSON error response body', async () => {
      mockFetch.mockResolvedValue(createJsonResponse({ message: 'Not found' }, 404, false));

      await expect(apiClient.get('/missing')).rejects.toThrow('Not found');
    });

    it('throws Error with HTTP status when response body has no message', async () => {
      mockFetch.mockResolvedValue(createJsonResponse({}, 500, false));

      await expect(apiClient.get('/error')).rejects.toThrow('HTTP 500');
    });

    it('throws Error with fallback message when response body is not JSON', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('Invalid JSON')),
      } as unknown as Response);

      await expect(apiClient.get('/bad-gateway')).rejects.toThrow('Request failed');
    });
  });

  describe('base URL resolution', () => {
    it('uses NEXT_PUBLIC_API_URL on client-side when set', async () => {
      vi.resetModules();
      mockFetch.mockReset();
      process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/v1';

      const mod = await import('./api-client');
      mockFetch.mockResolvedValue(createJsonResponse({}));
      await mod.apiClient.get('/test');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.example.com/v1/test');

      delete process.env.NEXT_PUBLIC_API_URL;
    });

    it('defaults to /api/v1 on client-side when NEXT_PUBLIC_API_URL is not set', async () => {
      vi.resetModules();
      mockFetch.mockReset();
      delete process.env.NEXT_PUBLIC_API_URL;

      const mod = await import('./api-client');
      mockFetch.mockResolvedValue(createJsonResponse({}));
      await mod.apiClient.get('/test');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/v1/test');
    });

    it('uses API_INTERNAL_URL on server-side when set', async () => {
      vi.resetModules();
      mockFetch.mockReset();
      process.env.API_INTERNAL_URL = 'http://api-internal:3001/api/v1';

      // Simulate server-side: window is undefined
      const originalWindow = global.window;
      // @ts-expect-error - intentionally removing window for server-side simulation
      delete global.window;

      const mod = await import('./api-client');
      mockFetch.mockResolvedValue(createJsonResponse({}));
      await mod.apiClient.get('/test');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://api-internal:3001/api/v1/test');

      global.window = originalWindow;
      delete process.env.API_INTERNAL_URL;
    });

    it('defaults to http://localhost:3001/api/v1 on server-side when API_INTERNAL_URL is not set', async () => {
      vi.resetModules();
      mockFetch.mockReset();
      delete process.env.API_INTERNAL_URL;

      const originalWindow = global.window;
      // @ts-expect-error - intentionally removing window for server-side simulation
      delete global.window;

      const mod = await import('./api-client');
      mockFetch.mockResolvedValue(createJsonResponse({}));
      await mod.apiClient.get('/test');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:3001/api/v1/test');

      global.window = originalWindow;
    });
  });

  describe('headers', () => {
    it('sends Content-Type: application/json by default', async () => {
      mockFetch.mockResolvedValue(createJsonResponse({}));
      await apiClient.get('/test');

      const headers = readHeaders(mockFetch.mock.calls[0]);
      expect(headers['content-type']).toBe('application/json');
    });

    it('merges custom headers with default Content-Type header', async () => {
      mockFetch.mockResolvedValue(createJsonResponse({}));
      await apiClient.get('/test', {
        headers: { Authorization: 'Bearer token123' },
      });

      const headers = readHeaders(mockFetch.mock.calls[0]);
      expect(headers['content-type']).toBe('application/json');
      expect(headers['authorization']).toBe('Bearer token123');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 6 · 6.18.1.4-hotfix — interceptor / refresh / broadcast tests.
// ─────────────────────────────────────────────────────────────────────

describe('apiFetch — 401 retry interceptor (Phase 6 · 6.18.1.4-hotfix)', () => {
  /**
   * Each test gets a fresh module instance so the in-flight refresh
   * cache and the auth adapter start clean.
   */
  let apiFetch: typeof import('./api-client').apiFetch;
  let configureApiAuth: typeof import('./api-client').configureApiAuth;
  let __resetApiAuthForTests: typeof import('./api-client').__resetApiAuthForTests;
  let TOKEN_REFRESHED_MESSAGE: typeof import('./api-client').TOKEN_REFRESHED_MESSAGE;
  let AUTH_BROADCAST_CHANNEL: typeof import('./api-client').AUTH_BROADCAST_CHANNEL;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    const mod = await import('./api-client');
    apiFetch = mod.apiFetch;
    configureApiAuth = mod.configureApiAuth;
    __resetApiAuthForTests = mod.__resetApiAuthForTests;
    TOKEN_REFRESHED_MESSAGE = mod.TOKEN_REFRESHED_MESSAGE;
    AUTH_BROADCAST_CHANNEL = mod.AUTH_BROADCAST_CHANNEL;
  });

  afterEach(() => {
    __resetApiAuthForTests();
  });

  it('attaches the Authorization: Bearer header from the auth adapter', async () => {
    configureApiAuth({
      getAccessToken: () => 'token-A',
      setAccessToken: vi.fn(),
      onAuthFailed: vi.fn(),
    });
    mockFetch.mockResolvedValueOnce(createJsonResponse({ ok: true }));

    await apiFetch('/me');

    const headers = readHeaders(mockFetch.mock.calls[0]);
    expect(headers['authorization']).toBe('Bearer token-A');
  });

  it('on 401, refreshes ONCE then retries the original request with the new token', async () => {
    let currentToken = 'old-token';
    const setAccessToken = vi.fn((next: string) => {
      currentToken = next;
    });
    configureApiAuth({
      getAccessToken: () => currentToken,
      setAccessToken,
      onAuthFailed: vi.fn(),
    });

    mockFetch
      // Original — 401 with stale token
      .mockResolvedValueOnce(createJsonResponse({ message: 'expired' }, 401, false))
      // Refresh — success
      .mockResolvedValueOnce(createJsonResponse({ accessToken: 'new-token' }))
      // Retry — success
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));

    const res = await apiFetch('/me');

    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(setAccessToken).toHaveBeenCalledWith('new-token');

    const refreshCallUrl = mockFetch.mock.calls[1][0] as string;
    expect(refreshCallUrl).toContain('/auth/refresh');

    const retryHeaders = readHeaders(mockFetch.mock.calls[2]);
    expect(retryHeaders['authorization']).toBe('Bearer new-token');
  });

  it('does NOT loop on 401 from the refresh endpoint itself', async () => {
    const onAuthFailed = vi.fn();
    configureApiAuth({
      getAccessToken: () => 'stale',
      setAccessToken: vi.fn(),
      onAuthFailed,
    });

    mockFetch
      // Original 401
      .mockResolvedValueOnce(createJsonResponse({ message: 'expired' }, 401, false))
      // Refresh also 401 (refresh-token revoked)
      .mockResolvedValueOnce(createJsonResponse({ message: 'no' }, 401, false));

    const res = await apiFetch('/me');

    expect(res.status).toBe(401);
    // 1 original + 1 refresh, no further retries.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(onAuthFailed).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent 401s onto a single in-flight refresh promise', async () => {
    const setAccessToken = vi.fn();
    configureApiAuth({
      getAccessToken: () => 'stale',
      setAccessToken,
      onAuthFailed: vi.fn(),
    });

    // Prepare 5 mock responses: 2 originals 401, 1 refresh, 2 retries.
    let resolveRefresh: (value: Response) => void = () => undefined;
    const refreshPromise = new Promise<Response>((r) => {
      resolveRefresh = r;
    });

    mockFetch
      .mockResolvedValueOnce(createJsonResponse({}, 401, false)) // original 1
      .mockResolvedValueOnce(createJsonResponse({}, 401, false)) // original 2
      .mockReturnValueOnce(refreshPromise) // refresh — only ONE
      .mockResolvedValueOnce(createJsonResponse({ a: 1 })) // retry 1
      .mockResolvedValueOnce(createJsonResponse({ b: 2 })); // retry 2

    const p1 = apiFetch('/a');
    const p2 = apiFetch('/b');

    // Wait a tick for both originals to fire.
    await Promise.resolve();
    await Promise.resolve();

    // Resolve the single refresh.
    resolveRefresh(createJsonResponse({ accessToken: 'fresh' }));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    // 2 originals + 1 refresh + 2 retries = 5
    expect(mockFetch).toHaveBeenCalledTimes(5);
    // setAccessToken called exactly once with the new token.
    expect(setAccessToken).toHaveBeenCalledTimes(1);
    expect(setAccessToken).toHaveBeenCalledWith('fresh');
  });

  it('posts {type:"token-refreshed"} on BroadcastChannel("auth") after a successful refresh', async () => {
    // Spy on BroadcastChannel — jsdom provides one in modern versions,
    // but we mock to assert the postMessage call shape.
    const postMessage = vi.fn();
    const close = vi.fn();
    const observed: { name?: string } = {};

    // vi.fn() arrow-mock can't be invoked with `new`; use a plain class
    // so the constructor receives `name`.
    class ChannelCtor {
      constructor(name: string) {
        observed.name = name;
      }
      postMessage = postMessage;
      close = close;
    }
    const original = global.BroadcastChannel;
    global.BroadcastChannel = ChannelCtor as unknown as typeof BroadcastChannel;

    try {
      configureApiAuth({
        getAccessToken: () => 'stale',
        setAccessToken: vi.fn(),
        onAuthFailed: vi.fn(),
      });

      mockFetch
        .mockResolvedValueOnce(createJsonResponse({}, 401, false))
        .mockResolvedValueOnce(createJsonResponse({ accessToken: 'new' }))
        .mockResolvedValueOnce(createJsonResponse({ ok: true }));

      await apiFetch('/me');

      expect(observed.name).toBe(AUTH_BROADCAST_CHANNEL);
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith({
        type: TOKEN_REFRESHED_MESSAGE,
        accessToken: 'new',
      });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      global.BroadcastChannel = original;
    }
  });

  it('does NOT retry when no auth adapter is configured', async () => {
    mockFetch.mockResolvedValueOnce(createJsonResponse({}, 401, false));

    const res = await apiFetch('/me');

    expect(res.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
