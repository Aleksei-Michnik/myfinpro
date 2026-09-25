export interface User {
  id: string;
  email: string;
  name: string;
  defaultCurrency: string;
  locale: string;
  timezone: string;
  emailVerified: boolean;
  hasPassword: boolean;
  deletedAt: string | null;
  scheduledDeletionAt: string | null;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
  defaultCurrency?: string;
  locale?: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

// Phase 20 · Iteration 20.7 — connector tokens (docs/ui/20.7-connector-tokens.md
// §0). The only scope a token can carry today. Mirrors the API's
// `API_TOKEN_SCOPE_ACCOUNTS_IMPORT` — the shared constant is owned by the API
// track (`packages/shared`) and does not exist yet; this literal is the
// placeholder until it lands there and this file imports it instead.
export const API_TOKEN_SCOPE_ACCOUNTS_IMPORT = 'accounts:import' as const;
export type ApiTokenScope = typeof API_TOKEN_SCOPE_ACCOUNTS_IMPORT;

/** Cap enforced by the API (`409 API_TOKEN_LIMIT_REACHED` past this count). */
export const API_TOKEN_MAX = 10;

/** A connector token as listed — never carries the raw secret. */
export interface ApiTokenSummary {
  id: string;
  name: string;
  scopes: ApiTokenScope[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** The create response — the raw `mfp_…` secret is present exactly once. */
export interface ApiTokenCreated extends ApiTokenSummary {
  token: string;
}
