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

/** The deployment default binding (what runs when `effective` is null). */
export type DeploymentExtractionProvider = 'mock' | 'anthropic' | 'openai' | 'unconfigured';

/** What a user's extraction would run on, before keys: a selection or a stored credential. */
export interface LlmBinding {
  provider: string;
  model: string;
  source: 'selection' | 'credential';
}

export interface LlmCatalogResponse {
  models: LlmCatalogModelEntry[];
  /** null = deployment default decides. */
  selection: LlmSelection | null;
  credentials: LlmCredentialHint[];
  sharedProviders: LlmProvider[];
  /** The deployment default binding (what runs when `effective` is null). */
  deploymentProvider: DeploymentExtractionProvider;
  /** What this user's extraction would run on, before keys: null = deployment default. */
  effective: LlmBinding | null;
}
