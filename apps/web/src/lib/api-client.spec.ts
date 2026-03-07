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

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('merges custom headers with default Content-Type header', async () => {
      mockFetch.mockResolvedValue(createJsonResponse({}));
      await apiClient.get('/test', {
        headers: { Authorization: 'Bearer token123' },
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.headers['Authorization']).toBe('Bearer token123');
    });
  });
});
