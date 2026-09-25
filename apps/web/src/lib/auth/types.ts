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
// §0). The scope and the cap are the API's; one constant each, in the shared
// package, never a second copy that could drift.
export {
  API_TOKEN_SCOPE_ACCOUNTS_IMPORT,
  API_TOKEN_MAX_ACTIVE as API_TOKEN_MAX,
} from '@myfinpro/shared';
export type { ApiTokenScope } from '@myfinpro/shared';
import type { ApiTokenScope } from '@myfinpro/shared';

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
