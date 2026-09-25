// Phase 20 · Iteration 20.7 — the only thing that talks to the app.
//
// One route matters: `POST /api/v1/accounts/:id/imports` with the
// `accounts:import` token in an Authorization header (design §6.4). A
// statement longer than the contract's cap is sent as consecutive chunks of
// exactly that size — one import row each, exactly as the web wizard does
// (design §6.2) — and the per-chunk counters are summed for the report.

import { ACCOUNT_IMPORT_MAX_LINES, type ImportLineInput } from '@myfinpro/shared';
import { apiError } from './errors.js';

export const API_PREFIX = '/api/v1';
export const HEALTH_PATH = `${API_PREFIX}/health`;

/** The `AccountImportResponseDto` fields the connector reports (design §6.2). */
export interface ImportResponse {
  id: string;
  totalCount: number;
  insertedCount: number;
  duplicateCount: number;
  suggestedMatchCount: number;
  suggestedTransferCount: number;
  suggestedCreateCount: number;
  needsInputCount: number;
}

/** The same counters, summed over every chunk of one account's import. */
export interface ImportSummary extends Omit<ImportResponse, 'id'> {
  importIds: string[];
  chunks: number;
}

/**
 * What an import carries besides its lines (design §6.2).
 *
 * The period covers the whole request and goes on EVERY chunk; the statement
 * balance describes the statement as a whole and goes on the LAST chunk only
 * — the same split the web import wizard uses, so one balance lands, not one
 * per chunk.
 */
export interface ImportMetadata {
  periodFrom?: string;
  periodTo?: string;
  statementBalanceCents?: number;
  statementBalanceAt?: string;
}

export type FetchLike = typeof fetch;

export interface ApiClientOptions {
  appUrl: string;
  token: string;
  /** Injected by the tests; production always uses the platform `fetch`. */
  fetchImpl?: FetchLike;
  /** Per-request timeout; a hung bank site must not hang the scheduler. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 60_000;

/** Splits into chunks of at most `size`, preserving order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new RangeError('chunk size must be at least 1');
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function summaryOf(responses: ImportResponse[]): ImportSummary {
  return responses.reduce<ImportSummary>(
    (total, response) => ({
      importIds: [...total.importIds, response.id],
      chunks: total.chunks + 1,
      totalCount: total.totalCount + response.totalCount,
      insertedCount: total.insertedCount + response.insertedCount,
      duplicateCount: total.duplicateCount + response.duplicateCount,
      suggestedMatchCount: total.suggestedMatchCount + response.suggestedMatchCount,
      suggestedTransferCount: total.suggestedTransferCount + response.suggestedTransferCount,
      suggestedCreateCount: total.suggestedCreateCount + response.suggestedCreateCount,
      needsInputCount: total.needsInputCount + response.needsInputCount,
    }),
    {
      importIds: [],
      chunks: 0,
      totalCount: 0,
      insertedCount: 0,
      duplicateCount: 0,
      suggestedMatchCount: 0,
      suggestedTransferCount: 0,
      suggestedCreateCount: 0,
      needsInputCount: 0,
    },
  );
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asImportResponse(body: unknown): ImportResponse {
  const value = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  return {
    id: typeof value.id === 'string' ? value.id : '',
    totalCount: numberOf(value.totalCount),
    insertedCount: numberOf(value.insertedCount),
    duplicateCount: numberOf(value.duplicateCount),
    suggestedMatchCount: numberOf(value.suggestedMatchCount),
    suggestedTransferCount: numberOf(value.suggestedTransferCount),
    suggestedCreateCount: numberOf(value.suggestedCreateCount),
    needsInputCount: numberOf(value.needsInputCount),
  };
}

export class ApiClient {
  private readonly appUrl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.appUrl = options.appUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** The address the user opens to review what was imported (design §7). */
  reviewUrl(accountId: string): string {
    return `${this.appUrl}/accounts/${encodeURIComponent(accountId)}?tab=review`;
  }

  /** Is the app there at all? Public route, no token — `doctor` uses it. */
  async health(): Promise<boolean> {
    try {
      const response = await this.request(HEALTH_PATH, { method: 'GET' }, false);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Posts one account's lines, chunked at `ACCOUNT_IMPORT_MAX_LINES`. Stops at
   * the first rejected chunk — a partial import is already recorded server-side
   * and re-running is safe, because the fingerprint dedups every line again.
   */
  async createImports(
    accountId: string,
    source: string,
    lines: readonly ImportLineInput[],
    metadata: ImportMetadata = {},
  ): Promise<ImportSummary> {
    const parts = chunk(lines, ACCOUNT_IMPORT_MAX_LINES);
    const responses: ImportResponse[] = [];
    for (const [index, part] of parts.entries()) {
      const last = index === parts.length - 1;
      responses.push(
        await this.createImport(accountId, source, part, {
          periodFrom: metadata.periodFrom,
          periodTo: metadata.periodTo,
          ...(last
            ? {
                statementBalanceCents: metadata.statementBalanceCents,
                statementBalanceAt: metadata.statementBalanceAt,
              }
            : {}),
        }),
      );
    }
    return summaryOf(responses);
  }

  private async createImport(
    accountId: string,
    source: string,
    lines: readonly ImportLineInput[],
    metadata: ImportMetadata,
  ): Promise<ImportResponse> {
    const path = `${API_PREFIX}/accounts/${encodeURIComponent(accountId)}/imports`;
    const response = await this.request(
      path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `originalName` is deliberately absent: there is no file here.
        // JSON.stringify drops the metadata fields that are undefined.
        body: JSON.stringify({ source, lines, ...metadata }),
      },
      true,
    );

    const body = await this.readJson(response);
    if (!response.ok) throw this.rejection(response.status, body);
    return asImportResponse(body);
  }

  private async request(
    path: string,
    init: RequestInit,
    authenticated: boolean,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (authenticated) headers.set('authorization', `Bearer ${this.token}`);

    try {
      return await this.fetchImpl(`${this.appUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown error';
      throw apiError(
        `Could not reach the app at ${this.appUrl} (${reason}).`,
        'Check the address in the config and that you are online.',
      );
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  /** Turns an error response into the exit-4 message (status + errorCode). */
  private rejection(status: number, body: unknown): Error {
    const value = (typeof body === 'object' && body !== null ? body : {}) as Record<
      string,
      unknown
    >;
    const errorCode = typeof value.errorCode === 'string' ? value.errorCode : undefined;
    const message = typeof value.message === 'string' ? value.message : undefined;

    if (status === 401) {
      return apiError(
        'The app refused the token (401): revoked or expired.',
        'Create a new token in Settings → Connector tokens, then run: myfinpro-connector init',
      );
    }
    if (status === 403) {
      return apiError(
        `The token may not import into this account (403${errorCode ? `, ${errorCode}` : ''}).`,
        'Check the account id in the config and that the token has the accounts:import scope.',
      );
    }
    if (status === 404) {
      return apiError(
        `No such account in the app (404${errorCode ? `, ${errorCode}` : ''}).`,
        'Run `myfinpro-connector accounts` and fix the mapping with `init`.',
      );
    }
    if (status === 429) {
      return apiError('The app is rate-limiting the import (429).', 'Wait a minute and run again.');
    }

    const detail = [errorCode, message].filter(Boolean).join(' — ');
    return apiError(`The app rejected the import (HTTP ${status}${detail ? `: ${detail}` : ''}).`);
  }
}
