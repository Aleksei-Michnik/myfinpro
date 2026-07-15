// Phase 8.11 — web-side wire types for the per-user LLM settings API
// (mirror of apps/api/src/llm; design: docs/runbook-llm-extraction.md §9).

import type { LlmProvider } from '@myfinpro/shared';

export interface LlmCatalogModelEntry {
  provider: LlmProvider;
  id: string;
  label: string;
  /** Provider has a deployment key or the user stored their own. */
  available: boolean;
}

export interface LlmSelection {
  provider: string;
  model: string;
}

/** Hint-only credential row — key material never reaches the client. */
export interface LlmCredentialHint {
  provider: string;
  keyHint: string;
  /** ISO 8601 datetime. */
  updatedAt: string;
}

export interface LlmCatalogResponse {
  models: LlmCatalogModelEntry[];
  /** null = deployment default decides. */
  selection: LlmSelection | null;
  credentials: LlmCredentialHint[];
  sharedProviders: LlmProvider[];
}
