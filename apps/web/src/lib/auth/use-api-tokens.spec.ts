import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApiTokens } from './use-api-tokens';

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ getAccessToken: () => 'test-token' }),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useApiTokens', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('listTokens() GETs /auth/tokens and returns the array', async () => {
    const list = [
      {
        id: 't-1',
        name: 'Laptop',
        scopes: ['accounts:import'],
        lastUsedAt: null,
        expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(200, list));
    const { result } = renderHook(() => useApiTokens());

    let tokens;
    await act(async () => {
      tokens = await result.current.listTokens();
    });

    expect(tokens).toEqual(list);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/auth/tokens',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('listTokens() tolerates a { data: [...] } envelope', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, { data: [] }),
    );
    const { result } = renderHook(() => useApiTokens());

    let tokens;
    await act(async () => {
      tokens = await result.current.listTokens();
    });

    expect(tokens).toEqual([]);
  });

  it('createToken() POSTs the name, the fixed scope and the expiry', async () => {
    const created = {
      id: 't-2',
      name: 'Laptop',
      scopes: ['accounts:import'],
      lastUsedAt: null,
      expiresAt: '2026-04-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      token: 'mfp_secret',
    };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(201, created),
    );
    const { result } = renderHook(() => useApiTokens());

    let response;
    await act(async () => {
      response = await result.current.createToken({
        name: 'Laptop',
        expiresAt: '2026-04-01T00:00:00Z',
      });
    });

    expect(response).toEqual(created);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/v1/auth/tokens');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Laptop',
      scopes: ['accounts:import'],
      expiresAt: '2026-04-01T00:00:00Z',
    });
  });

  it('createToken() omits expiresAt for "never"', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(201, {
        id: 't-3',
        name: 'Server',
        scopes: ['accounts:import'],
        lastUsedAt: null,
        expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        token: 'mfp_secret2',
      }),
    );
    const { result } = renderHook(() => useApiTokens());

    await act(async () => {
      await result.current.createToken({ name: 'Server' });
    });

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Server',
      scopes: ['accounts:import'],
    });
  });

  it('revokeToken() DELETEs /auth/tokens/:id', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(204, null));
    const { result } = renderHook(() => useApiTokens());

    await act(async () => {
      await result.current.revokeToken('t-1');
    });

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/v1/auth/tokens/t-1');
    expect(init.method).toBe('DELETE');
  });

  it('createToken() surfaces the errorCode and status from a 409', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(409, { errorCode: 'API_TOKEN_LIMIT_REACHED', message: 'Limit reached' }),
    );
    const { result } = renderHook(() => useApiTokens());

    await expect(result.current.createToken({ name: 'One too many' })).rejects.toMatchObject({
      message: 'Limit reached',
      errorCode: 'API_TOKEN_LIMIT_REACHED',
      status: 409,
    });
  });
});
