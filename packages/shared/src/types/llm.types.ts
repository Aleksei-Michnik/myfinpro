// Phase 8.11 — per-user LLM selection (docs/runbook-llm-extraction.md §9).
//
// The curated provider/model catalog is the single source of truth shared by
// the API (selection validation, provider resolution) and the web app
// (settings picker). Adding a model here is the only step needed to offer it;
// removing one turns existing selections into a permanent, user-visible
// extraction failure rather than an undefined model call.

export const LLM_PROVIDERS = ['anthropic', 'openai'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export function isLlmProvider(value: string): value is LlmProvider {
  return (LLM_PROVIDERS as readonly string[]).includes(value);
}

export interface LlmCatalogModel {
  provider: LlmProvider;
  /** Provider-side model id, sent verbatim to the provider API. */
  id: string;
  /** Human-readable label for pickers. */
  label: string;
}

export const LLM_MODEL_CATALOG: readonly LlmCatalogModel[] = [
  { provider: 'anthropic', id: 'claude-fable-5', label: 'Anthropic Claude Fable 5' },
  { provider: 'anthropic', id: 'claude-sonnet-5', label: 'Anthropic Claude Sonnet 5' },
  { provider: 'anthropic', id: 'claude-opus-4-8', label: 'Anthropic Claude Opus 4.8' },
  { provider: 'anthropic', id: 'claude-haiku-4-5', label: 'Anthropic Claude Haiku 4.5' },
  { provider: 'openai', id: 'gpt-5.6', label: 'OpenAI GPT-5.6' },
  { provider: 'openai', id: 'gpt-5.2', label: 'OpenAI GPT-5.2' },
];

export function findLlmModel(provider: string, modelId: string): LlmCatalogModel | null {
  return LLM_MODEL_CATALOG.find((m) => m.provider === provider && m.id === modelId) ?? null;
}

/**
 * Shape gate for BYOK API keys before storage — rejects obviously wrong
 * values (wrong provider, whitespace, truncated paste). Liveness is verified
 * separately with a real provider call at save time (runbook §9.4 layer 5).
 * The OpenAI pattern explicitly excludes `sk-ant-` so an Anthropic key pasted
 * into the OpenAI slot fails fast instead of at the live probe.
 */
export const LLM_API_KEY_PATTERNS: Record<LlmProvider, RegExp> = {
  anthropic: /^sk-ant-[A-Za-z0-9_-]{20,250}$/,
  openai: /^sk-(?!ant-)[A-Za-z0-9_-]{20,250}$/,
};
