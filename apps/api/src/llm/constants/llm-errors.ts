/** Machine-readable error codes for the per-user LLM settings API. */
export const LLM_ERRORS = {
  /** :provider path segment is not a supported provider. */
  LLM_INVALID_PROVIDER: 'LLM_INVALID_PROVIDER',
  /** provider/model pair is not in the shared catalog. */
  LLM_INVALID_MODEL: 'LLM_INVALID_MODEL',
  /** Selected provider has neither a user key nor a shared deployment key. */
  LLM_PROVIDER_UNAVAILABLE: 'LLM_PROVIDER_UNAVAILABLE',
  /** API key fails the provider's shape gate (wrong prefix/format). */
  LLM_INVALID_API_KEY: 'LLM_INVALID_API_KEY',
  /** Provider rejected the key on the save-time live probe. */
  LLM_KEY_REJECTED: 'LLM_KEY_REJECTED',
  LLM_CREDENTIAL_NOT_FOUND: 'LLM_CREDENTIAL_NOT_FOUND',
  /** LLM_SECRETS_ENCRYPTION_KEY is not configured on this deployment. */
  LLM_STORAGE_UNCONFIGURED: 'LLM_STORAGE_UNCONFIGURED',
  /** Credential writes require a recently issued session token. */
  LLM_REAUTH_REQUIRED: 'LLM_REAUTH_REQUIRED',
} as const;
