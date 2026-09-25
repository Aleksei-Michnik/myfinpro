import { ACCOUNT_IMPORT_MAX_LINES, type ImportLineInput } from '@myfinpro/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, chunk, type FetchLike } from './client.js';
import { EXIT_API, type ConnectorError } from './errors.js';

const APP_URL = 'https://app.example.com';
const TOKEN = 'mfp_placeholder0123456789abc';
const ACCOUNT_ID = '3f1d0f1a-9b1e-4c2a-8f3d-6a7b8c9d0e1f';

function lines(count: number): ImportLineInput[] {
  return Array.from({ length: count }, (_unused, index) => ({
    postedAt: '2026-09-03',
    amountCents: index + 1,
    direction: 'OUT' as const,
    currency: 'ILS',
    description: `row ${index}`,
  }));
}

function importResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'import-1',
    totalCount: 1,
    insertedCount: 1,
    duplicateCount: 0,
    suggestedMatchCount: 0,
    suggestedTransferCount: 0,
    suggestedCreateCount: 0,
    needsInputCount: 1,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(fetchImpl: FetchLike): ApiClient {
  return new ApiClient({ appUrl: `${APP_URL}/`, token: TOKEN, fetchImpl });
}

async function failureOf(run: () => Promise<unknown>): Promise<ConnectorError> {
  const error = (await run().then(
    () => null,
    (caught: unknown) => caught,
  )) as ConnectorError | null;
  if (!error) throw new Error('expected a failure');
  expect(error.exitCode).toBe(EXIT_API);
  return error;
}

describe('chunk', () => {
  it('splits in order and refuses a useless size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe('createImports', () => {
  it('posts one request with the token, the source and no file name', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(importResponse()));
    await clientWith(fetchImpl as unknown as FetchLike).createImports(
      ACCOUNT_ID,
      'hapoalim',
      lines(1),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${APP_URL}/api/v1/accounts/${ACCOUNT_ID}/imports`);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.source).toBe('hapoalim');
    expect(body).not.toHaveProperty('originalName');
    expect((body.lines as unknown[]).length).toBe(1);
  });

  it('chunks at the contract cap and sums the counters', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(importResponse({ totalCount: 10, insertedCount: 7, duplicateCount: 3 })),
    );
    const summary = await clientWith(fetchImpl as unknown as FetchLike).createImports(
      ACCOUNT_ID,
      'connector',
      lines(ACCOUNT_IMPORT_MAX_LINES + 1),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const sizes = fetchImpl.mock.calls.map(
      (call) =>
        (JSON.parse(String((call[1] as RequestInit).body)) as { lines: unknown[] }).lines.length,
    );
    expect(sizes).toEqual([ACCOUNT_IMPORT_MAX_LINES, 1]);
    expect(summary.chunks).toBe(2);
    expect(summary.insertedCount).toBe(14);
    expect(summary.duplicateCount).toBe(6);
    expect(summary.needsInputCount).toBe(2);
    expect(summary.importIds).toEqual(['import-1', 'import-1']);
  });

  it('puts the period on every chunk and the balance on the last only', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(importResponse()));
    await clientWith(fetchImpl as unknown as FetchLike).createImports(
      ACCOUNT_ID,
      'hapoalim',
      lines(ACCOUNT_IMPORT_MAX_LINES + 1),
      {
        periodFrom: '2026-07-27',
        periodTo: '2026-09-25',
        statementBalanceCents: 1234567,
        statementBalanceAt: '2026-09-24',
      },
    );

    const bodies = fetchImpl.mock.calls.map(
      (call) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>,
    );
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body.periodFrom).toBe('2026-07-27');
      expect(body.periodTo).toBe('2026-09-25');
    }
    expect(bodies[0]).not.toHaveProperty('statementBalanceCents');
    expect(bodies[0]).not.toHaveProperty('statementBalanceAt');
    expect(bodies[1]).toMatchObject({
      statementBalanceCents: 1234567,
      statementBalanceAt: '2026-09-24',
    });
  });

  it('sends no balance and no period when the scrape reported none', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(importResponse()));
    await clientWith(fetchImpl as unknown as FetchLike).createImports(
      ACCOUNT_ID,
      'connector',
      lines(1),
      { periodFrom: '2026-07-27', periodTo: '2026-09-25' },
    );

    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)) as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('statementBalanceCents');
    expect(body).not.toHaveProperty('statementBalanceAt');
    expect(body.periodFrom).toBe('2026-07-27');
  });

  it('carries a single-chunk balance on that one chunk', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(importResponse()));
    await clientWith(fetchImpl as unknown as FetchLike).createImports(
      ACCOUNT_ID,
      'connector',
      lines(1),
      { statementBalanceCents: -25050, statementBalanceAt: '2026-09-24' },
    );

    expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      statementBalanceCents: -25050,
      statementBalanceAt: '2026-09-24',
    });
  });

  it('stops at the first rejected chunk', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(importResponse()))
      .mockResolvedValueOnce(jsonResponse({ statusCode: 400 }, 400));

    await failureOf(() =>
      clientWith(fetchImpl as unknown as FetchLike).createImports(
        ACCOUNT_ID,
        'connector',
        lines(ACCOUNT_IMPORT_MAX_LINES + 1),
      ),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('createImports — what the app can answer', () => {
  async function post(status: number, body: unknown): Promise<ConnectorError> {
    const fetchImpl = vi.fn(async () => jsonResponse(body, status));
    return failureOf(() =>
      clientWith(fetchImpl as unknown as FetchLike).createImports(
        ACCOUNT_ID,
        'connector',
        lines(1),
      ),
    );
  }

  it('401 tells the user the token is gone and what to run', async () => {
    const error = await post(401, { statusCode: 401, message: 'Unauthorized' });
    expect(error.message).toContain('401');
    expect(error.hint).toContain('init');
  });

  it('400 carries the status and the app error code', async () => {
    const error = await post(400, {
      statusCode: 400,
      errorCode: 'ACCOUNT_IMPORT_INVALID_LINE',
      message: 'lines[3]: amountCents must be positive',
    });
    expect(error.message).toContain('HTTP 400');
    expect(error.message).toContain('ACCOUNT_IMPORT_INVALID_LINE');
  });

  it('409 carries the status and the app error code', async () => {
    const error = await post(409, { statusCode: 409, errorCode: 'ACCOUNT_CURRENCY_MISMATCH' });
    expect(error.message).toContain('HTTP 409');
    expect(error.message).toContain('ACCOUNT_CURRENCY_MISMATCH');
  });

  it('404 and 403 name the account and the scope', async () => {
    expect((await post(404, { errorCode: 'ACCOUNT_NOT_FOUND' })).message).toContain('404');
    expect((await post(403, { errorCode: 'ACCOUNT_FORBIDDEN' })).hint).toContain('accounts:import');
  });

  it('429 asks for patience', async () => {
    expect((await post(429, {})).message).toContain('429');
  });

  it('a network failure names the address, never the token', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const error = await failureOf(() =>
      clientWith(fetchImpl as unknown as FetchLike).createImports(
        ACCOUNT_ID,
        'connector',
        lines(1),
      ),
    );
    expect(error.message).toContain(APP_URL);
    expect(error.message).not.toContain(TOKEN);
  });
});

describe('health and reviewUrl', () => {
  it('asks the public health route without a token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await clientWith(fetchImpl as unknown as FetchLike).health()).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${APP_URL}/api/v1/health`);
    expect(new Headers(init.headers).get('authorization')).toBeNull();
  });

  it('is false when the app does not answer', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await clientWith(fetchImpl as unknown as FetchLike).health()).toBe(false);
  });

  it('points at the review tab of the account', () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    expect(clientWith(fetchImpl as unknown as FetchLike).reviewUrl(ACCOUNT_ID)).toBe(
      `${APP_URL}/accounts/${ACCOUNT_ID}?tab=review`,
    );
  });
});
