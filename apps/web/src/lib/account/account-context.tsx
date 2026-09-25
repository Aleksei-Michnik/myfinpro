'use client';

// Phase 20 · Iteration 20.3 — AccountProvider (the budget/product-context
// conventions: every method takes an optional AbortSignal, errors are rich
// ApiError-shaped objects carrying the API's `errorCode`).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  AccountImport,
  AccountImportListResponse,
  AccountListResponse,
  AccountSummary,
  ApplySuggestionsResult,
  CreateAccountInput,
  CreateFromLineInput,
  CreateImportInput,
  ListAccountsParams,
  ListLinesParams,
  StatementLineDecision,
  StatementLineListResponse,
  UpdateAccountInput,
} from './types';
import { useAuth } from '@/lib/auth/auth-context';
import { useRealtimeEvents } from '@/lib/realtime/use-realtime-events';
import { useRealtimeResync } from '@/lib/realtime/use-realtime-resync';

export interface AccountApiError extends Error {
  errorCode?: string;
  status?: number;
}

interface AccountContextValue {
  fetchAccounts(params?: ListAccountsParams, signal?: AbortSignal): Promise<AccountListResponse>;
  getAccount(id: string, signal?: AbortSignal): Promise<AccountSummary>;
  createAccount(input: CreateAccountInput, signal?: AbortSignal): Promise<AccountSummary>;
  updateAccount(
    id: string,
    patch: UpdateAccountInput,
    signal?: AbortSignal,
  ): Promise<AccountSummary>;
  deleteAccount(id: string, signal?: AbortSignal): Promise<void>;
  archiveAccount(id: string, signal?: AbortSignal): Promise<AccountSummary>;
  unarchiveAccount(id: string, signal?: AbortSignal): Promise<AccountSummary>;
  /**
   * Every account the user can see (archived included), by id — for the
   * badges on transaction rows and the detail header, which only carry an
   * `accountId`. Fetched lazily on first use, refreshed on `account.updated`
   * and after a resync; `null` until the first load resolves.
   */
  directory: ReadonlyMap<string, AccountSummary> | null;
  /** Asks for the directory (idempotent). */
  ensureDirectory(): void;

  // ── 20.5 — statement imports and the review queue ──
  createImport(
    accountId: string,
    input: CreateImportInput,
    signal?: AbortSignal,
  ): Promise<AccountImport>;
  fetchImports(
    accountId: string,
    params?: { limit?: number; cursor?: string },
    signal?: AbortSignal,
  ): Promise<AccountImportListResponse>;
  fetchLines(
    accountId: string,
    params?: ListLinesParams,
    signal?: AbortSignal,
  ): Promise<StatementLineListResponse>;
  matchLine(
    accountId: string,
    lineId: string,
    transactionId: string,
    signal?: AbortSignal,
  ): Promise<StatementLineDecision>;
  createFromLine(
    accountId: string,
    lineId: string,
    input: CreateFromLineInput,
    signal?: AbortSignal,
  ): Promise<StatementLineDecision>;
  transferFromLine(
    accountId: string,
    lineId: string,
    transferAccountId: string,
    signal?: AbortSignal,
  ): Promise<StatementLineDecision>;
  ignoreLine(
    accountId: string,
    lineId: string,
    signal?: AbortSignal,
  ): Promise<StatementLineDecision>;
  /** Back to PENDING; the transaction is left untouched. */
  unlinkLine(
    accountId: string,
    lineId: string,
    signal?: AbortSignal,
  ): Promise<StatementLineDecision>;
  applySuggestions(
    accountId: string,
    lineIds?: string[],
    signal?: AbortSignal,
  ): Promise<ApplySuggestionsResult>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'boolean') sp.append(k, v ? 'true' : 'false');
    else sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    errorCode?: string;
  };
  const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  const err = new Error(msg || fallback) as AccountApiError;
  if (body.errorCode) err.errorCode = body.errorCode;
  err.status = res.status;
  throw err;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuth();

  const authHeaders = useCallback((): HeadersInit => {
    const token = getAccessToken();
    if (!token) throw new Error('Not authenticated');
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }, [getAccessToken]);

  const fetchAccounts = useCallback(
    async (params?: ListAccountsParams, signal?: AbortSignal): Promise<AccountListResponse> => {
      const res = await fetch(`${API_BASE}/accounts${buildQuery({ ...params })}`, {
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to load accounts');
      return (await res.json()) as AccountListResponse;
    },
    [authHeaders],
  );

  const getAccount = useCallback(
    async (id: string, signal?: AbortSignal): Promise<AccountSummary> => {
      const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(id)}`, {
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to load account');
      return (await res.json()) as AccountSummary;
    },
    [authHeaders],
  );

  const createAccount = useCallback(
    async (input: CreateAccountInput, signal?: AbortSignal): Promise<AccountSummary> => {
      const res = await fetch(`${API_BASE}/accounts`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(input),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to create account');
      return (await res.json()) as AccountSummary;
    },
    [authHeaders],
  );

  const updateAccount = useCallback(
    async (
      id: string,
      patch: UpdateAccountInput,
      signal?: AbortSignal,
    ): Promise<AccountSummary> => {
      const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(patch),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to update account');
      return (await res.json()) as AccountSummary;
    },
    [authHeaders],
  );

  const deleteAccount = useCallback(
    async (id: string, signal?: AbortSignal): Promise<void> => {
      const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, 'Failed to delete account');
      // 204 → nothing to read.
    },
    [authHeaders],
  );

  // Archive / unarchive share the POST /accounts/:id/<action> shape.
  const archiveAction = useCallback(
    async (
      id: string,
      action: 'archive' | 'unarchive',
      signal?: AbortSignal,
    ): Promise<AccountSummary> => {
      const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) await throwApiError(res, `Failed to ${action} account`);
      return (await res.json()) as AccountSummary;
    },
    [authHeaders],
  );

  const archiveAccount = useCallback(
    (id: string, signal?: AbortSignal) => archiveAction(id, 'archive', signal),
    [archiveAction],
  );
  const unarchiveAccount = useCallback(
    (id: string, signal?: AbortSignal) => archiveAction(id, 'unarchive', signal),
    [archiveAction],
  );

  // ── 20.5 — imports and lines share one request helper ───────────────────
  const request = useCallback(
    async <T,>(
      path: string,
      init: { method?: string; body?: unknown; signal?: AbortSignal },
      fallback: string,
    ): Promise<T> => {
      const res = await fetch(`${API_BASE}${path}`, {
        method: init.method ?? 'GET',
        headers: authHeaders(),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal,
      });
      if (!res.ok) await throwApiError(res, fallback);
      return (await res.json()) as T;
    },
    [authHeaders],
  );
  const accountPath = (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`;
  const linePath = (accountId: string, lineId: string) =>
    `${accountPath(accountId)}/lines/${encodeURIComponent(lineId)}`;

  const createImport = useCallback(
    (accountId: string, input: CreateImportInput, signal?: AbortSignal) =>
      request<AccountImport>(
        `${accountPath(accountId)}/imports`,
        { method: 'POST', body: input, signal },
        'Failed to import statement',
      ),
    [request],
  );
  const fetchImports = useCallback(
    (accountId: string, params?: { limit?: number; cursor?: string }, signal?: AbortSignal) =>
      request<AccountImportListResponse>(
        `${accountPath(accountId)}/imports${buildQuery({ ...params })}`,
        { signal },
        'Failed to load imports',
      ),
    [request],
  );
  const fetchLines = useCallback(
    (accountId: string, params?: ListLinesParams, signal?: AbortSignal) =>
      request<StatementLineListResponse>(
        `${accountPath(accountId)}/lines${buildQuery({ ...params })}`,
        { signal },
        'Failed to load statement lines',
      ),
    [request],
  );
  const matchLine = useCallback(
    (accountId: string, lineId: string, transactionId: string, signal?: AbortSignal) =>
      request<StatementLineDecision>(
        `${linePath(accountId, lineId)}/match`,
        { method: 'POST', body: { transactionId }, signal },
        'Failed to match line',
      ),
    [request],
  );
  const createFromLine = useCallback(
    (accountId: string, lineId: string, input: CreateFromLineInput, signal?: AbortSignal) =>
      request<StatementLineDecision>(
        `${linePath(accountId, lineId)}/create`,
        { method: 'POST', body: input, signal },
        'Failed to create transaction from line',
      ),
    [request],
  );
  const transferFromLine = useCallback(
    (accountId: string, lineId: string, transferAccountId: string, signal?: AbortSignal) =>
      request<StatementLineDecision>(
        `${linePath(accountId, lineId)}/transfer`,
        { method: 'POST', body: { transferAccountId }, signal },
        'Failed to record transfer',
      ),
    [request],
  );
  const ignoreLine = useCallback(
    (accountId: string, lineId: string, signal?: AbortSignal) =>
      request<StatementLineDecision>(
        `${linePath(accountId, lineId)}/ignore`,
        { method: 'POST', signal },
        'Failed to ignore line',
      ),
    [request],
  );
  const unlinkLine = useCallback(
    (accountId: string, lineId: string, signal?: AbortSignal) =>
      request<StatementLineDecision>(
        `${linePath(accountId, lineId)}/link`,
        { method: 'DELETE', signal },
        'Failed to undo decision',
      ),
    [request],
  );
  const applySuggestions = useCallback(
    (accountId: string, lineIds?: string[], signal?: AbortSignal) =>
      request<ApplySuggestionsResult>(
        `${accountPath(accountId)}/lines/apply-suggestions`,
        { method: 'POST', body: lineIds ? { lineIds } : {}, signal },
        'Failed to apply suggestions',
      ),
    [request],
  );

  // ── Directory (name lookup for rows) ────────────────────────────────────
  const { isAuthenticated } = useAuth();
  const [directory, setDirectory] = useState<ReadonlyMap<string, AccountSummary> | null>(null);
  const [wanted, setWanted] = useState(false);
  const [directoryVersion, setDirectoryVersion] = useState(0);
  const ensureDirectory = useCallback(() => setWanted(true), []);
  const bumpDirectory = useCallback(() => setDirectoryVersion((v) => v + 1), []);
  useRealtimeEvents({ type: 'account.updated' }, bumpDirectory);
  useRealtimeResync(bumpDirectory);

  useEffect(() => {
    if (!wanted || !isAuthenticated) return;
    const controller = new AbortController();
    void fetchAccounts({ scope: 'all', includeArchived: true, limit: 100 }, controller.signal)
      .then((res) => setDirectory(new Map(res.data.map((a) => [a.id, a]))))
      // Advisory lookup only — a failed load leaves the badges out, nothing else.
      .catch(() => undefined);
    return () => controller.abort();
  }, [wanted, isAuthenticated, directoryVersion, fetchAccounts]);

  const value = useMemo<AccountContextValue>(
    () => ({
      fetchAccounts,
      getAccount,
      createAccount,
      updateAccount,
      deleteAccount,
      archiveAccount,
      unarchiveAccount,
      directory,
      ensureDirectory,
      createImport,
      fetchImports,
      fetchLines,
      matchLine,
      createFromLine,
      transferFromLine,
      ignoreLine,
      unlinkLine,
      applySuggestions,
    }),
    [
      fetchAccounts,
      getAccount,
      createAccount,
      updateAccount,
      deleteAccount,
      archiveAccount,
      unarchiveAccount,
      directory,
      ensureDirectory,
      createImport,
      fetchImports,
      fetchLines,
      matchLine,
      createFromLine,
      transferFromLine,
      ignoreLine,
      unlinkLine,
      applySuggestions,
    ],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccounts(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccounts must be used within an AccountProvider');
  return ctx;
}

/**
 * The context when a provider is mounted, else `null` — for surfaces that
 * merely decorate with account data (rows, pickers) and must keep working
 * in specs that render them without the provider tree.
 */
export function useOptionalAccounts(): AccountContextValue | null {
  return useContext(AccountContext);
}

/** The account directory, requested on mount — `null` until loaded (or without a provider). */
export function useAccountDirectory(): ReadonlyMap<string, AccountSummary> | null {
  const ctx = useOptionalAccounts();
  const ensure = ctx?.ensureDirectory;
  useEffect(() => {
    if (ensure) ensure();
  }, [ensure]);
  return ctx?.directory ?? null;
}
