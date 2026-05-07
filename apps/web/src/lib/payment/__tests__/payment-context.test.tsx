import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentProvider, usePayments } from '../payment-context';

// ── Mock the auth context to inject a fixed bearer token ──────────────────
vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    getAccessToken: () => 'test-token',
  }),
}));

const API = '/api/v1';

/** Build a mocked Response with a given status + JSON body. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Typed fetch spy so we can inspect URL + init arguments. */
function fetchSpy() {
  return vi.fn() as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

// Wrapper that provides <PaymentProvider>.
const wrapper = ({ children }: { children: ReactNode }) => (
  <PaymentProvider>{children}</PaymentProvider>
);

describe('usePayments', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws when used outside the provider', () => {
    // Suppress the expected error log that React emits when a hook throws.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => usePayments())).toThrow(/PaymentProvider/);
    spy.mockRestore();
  });

  it('fetchList() with no params hits GET /payments with no query string', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, { data: [], nextCursor: null, hasMore: false }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    const out = await result.current.fetchList();
    expect(fetch).toHaveBeenCalledWith(
      `${API}/payments`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(out.data).toEqual([]);
  });

  it('fetchList() passes filters as a query string', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, { data: [], nextCursor: null, hasMore: false }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    await result.current.fetchList({ scope: 'personal', direction: 'OUT', starred: true });
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(call).toContain('scope=personal');
    expect(call).toContain('direction=OUT');
    expect(call).toContain('starred=true');
  });

  it('getPayment(id) fetches GET /payments/:id', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, { id: 'p-1' }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    await result.current.getPayment('p-1');
    expect(fetch).toHaveBeenCalledWith(
      `${API}/payments/p-1`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('createPayment posts the body as JSON', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(201, { id: 'p-new' }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    await result.current.createPayment({
      direction: 'OUT',
      type: 'ONE_TIME',
      amountCents: 1000,
      currency: 'USD',
      occurredAt: '2026-01-01T00:00:00Z',
      categoryId: 'cat-1',
      attributions: [{ scope: 'personal' }],
    });
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      direction: 'OUT',
      categoryId: 'cat-1',
    });
  });

  it('updatePayment returns the body on 200', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, { id: 'p-1', note: 'updated' }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    const out = await result.current.updatePayment('p-1', { note: 'updated' });
    expect(out).toMatchObject({ id: 'p-1', note: 'updated' });
  });

  it('updatePayment returns null on 204 (payment hard-deleted)', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(204, null));
    const { result } = renderHook(() => usePayments(), { wrapper });
    const out = await result.current.updatePayment('p-1', { attributions: [] });
    expect(out).toBeNull();
  });

  it('removePayment(id, scope) appends ?scope=', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, {
        deletedAttributions: 1,
        addedAttributions: 0,
        paymentDeleted: true,
        payment: null,
      }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    await result.current.removePayment('p-1', 'group:g-1');
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('?scope=group%3Ag-1');
  });

  it('removePayment(id) without scope has no query', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, {
        deletedAttributions: 0,
        addedAttributions: 0,
        paymentDeleted: true,
        payment: null,
      }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    await result.current.removePayment('p-1');
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(`${API}/payments/p-1`);
  });

  it('toggleStar posts to /payments/:id/star', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, { starred: true, starCount: 1 }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    const out = await result.current.toggleStar('p-1');
    expect(fetch).toHaveBeenCalledWith(
      `${API}/payments/p-1/star`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(out).toEqual({ starred: true, starCount: 1 });
  });

  it('listComments(paymentId) with no opts has no query', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, { data: [], nextCursor: null, hasMore: false }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    await result.current.listComments('p-1');
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(`${API}/payments/p-1/comments`);
  });

  it('listComments with cursor appends ?cursor=', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, { data: [], nextCursor: null, hasMore: false }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    await result.current.listComments('p-1', { cursor: 'abc', limit: 10 });
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('cursor=abc');
    expect(url).toContain('limit=10');
  });

  it('postComment returns the created comment', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(201, { id: 'c-1', content: 'hi' }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    const out = await result.current.postComment('p-1', 'hi');
    expect(out).toMatchObject({ id: 'c-1', content: 'hi' });
  });

  it('editComment PATCH returns body', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, { id: 'c-1', content: 'edited' }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    const out = await result.current.editComment('p-1', 'c-1', 'edited');
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(out).toMatchObject({ id: 'c-1', content: 'edited' });
  });

  it('deleteComment resolves without throwing on 204', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(204, null));
    const { result } = renderHook(() => usePayments(), { wrapper });
    await expect(result.current.deleteComment('p-1', 'c-1')).resolves.toBeUndefined();
  });

  it('listCategories passes direction + scope as query string', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(200, []));
    const { result } = renderHook(() => usePayments(), { wrapper });
    await result.current.listCategories({ direction: 'OUT', scope: 'group:g-1' });
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('direction=OUT');
    expect(url).toContain('scope=group%3Ag-1');
  });

  it('isLoading flips true during a call and back to false', async () => {
    let resolveFn!: (r: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveFn = r;
    });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(pending);
    const { result } = renderHook(() => usePayments(), { wrapper });
    expect(result.current.isLoading).toBe(false);
    act(() => {
      void result.current.fetchList();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    await act(async () => {
      resolveFn(jsonResponse(200, { data: [], nextCursor: null, hasMore: false }));
      await pending;
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('captures error state on failure and clearError() resets it', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(500, { message: 'Boom' }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    await expect(result.current.getPayment('p-1')).rejects.toThrow(/Boom/);
    await waitFor(() => expect(result.current.error).toBe('Boom'));
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it('propagates errorCode from API error payloads', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(404, { message: 'Not found', errorCode: 'PAYMENT_NOT_FOUND' }),
    );
    const { result } = renderHook(() => usePayments(), { wrapper });
    try {
      await result.current.getPayment('missing');
      expect.fail('Expected throw');
    } catch (err) {
      expect((err as { errorCode?: string }).errorCode).toBe('PAYMENT_NOT_FOUND');
      expect((err as { status?: number }).status).toBe(404);
    }
  });
});
