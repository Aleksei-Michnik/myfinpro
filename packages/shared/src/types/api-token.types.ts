// Phase 20 · Iteration 20.7 — scoped personal access tokens (design §6.4).
//
// The user-run connector scrapes on the user's own machine and pushes the
// resulting lines with one of these tokens. The safety property is
// structural: a token grants exactly the scopes it carries, and the only
// scope that exists grants exactly one route — there is no endpoint that
// could accept a bank password.
//
// Consumed by apps/api (DTO validation, the guard), apps/web (the settings
// page that creates and revokes them) and apps/connector.

/**
 * Every scope a token may carry. v1 knows one: pushing statement lines into
 * an account the token's owner can already reach (`POST /accounts/:id/imports`).
 */
export const API_TOKEN_SCOPES = ['accounts:import'] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/** The scope `POST /accounts/:accountId/imports` requires. */
export const API_TOKEN_SCOPE_ACCOUNTS_IMPORT: ApiTokenScope = 'accounts:import';

/**
 * Bearer values starting with this prefix are personal access tokens, not
 * JWTs — which is how `JwtOrApiTokenGuard` tells the two paths apart.
 */
export const API_TOKEN_PREFIX = 'mfp_';

/** URL-safe random characters after the prefix (30 random bytes, base64url). */
export const API_TOKEN_RANDOM_LENGTH = 40;

/** Active (neither revoked nor expired) tokens one user may hold at a time. */
export const API_TOKEN_MAX_ACTIVE = 10;

/** Maximum length of the human label shown in settings. */
export const API_TOKEN_NAME_MAX_LENGTH = 100;

/** A token as listed in settings — never carries the secret. */
export interface ApiTokenSummary {
  id: string;
  name: string;
  scopes: ApiTokenScope[];
  /** ISO 8601, or null while the token has never been used. */
  lastUsedAt: string | null;
  /** ISO 8601, or null for a token that does not expire. */
  expiresAt: string | null;
  createdAt: string;
}

/**
 * The creation response — the one and only time the raw token exists outside
 * the caller's own storage. Only its SHA-256 hash is kept server-side.
 */
export interface ApiTokenCreated {
  id: string;
  name: string;
  scopes: ApiTokenScope[];
  /** Shown exactly once; unrecoverable afterwards. */
  token: string;
  createdAt: string;
  expiresAt: string | null;
}
