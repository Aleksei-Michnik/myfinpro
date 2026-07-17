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

// Verified against provider lineups 2026-07-12: Anthropic — Fable 5,
// Sonnet 5, Opus 4.8; OpenAI — the GPT-5.6 family (GA 2026-07-09:
// `gpt-5.6` is the alias for the flagship gpt-5.6-sol, with Terra and Luna
// as the balanced/efficient sizes) plus GPT-5.2 as the previous-generation
// option.
//
// Compatibility bar (8.21): every Anthropic model here must accept adaptive
// thinking + structured outputs, every OpenAI model strict json_schema —
// that is exactly what the extraction call sends. Claude Haiku 4.5 was
// removed after rejecting `thinking: adaptive` with a 400 in production.
export const LLM_MODEL_CATALOG: readonly LlmCatalogModel[] = [
  { provider: 'anthropic', id: 'claude-fable-5', label: 'Anthropic Claude Fable 5' },
  { provider: 'anthropic', id: 'claude-sonnet-5', label: 'Anthropic Claude Sonnet 5' },
  { provider: 'anthropic', id: 'claude-opus-4-8', label: 'Anthropic Claude Opus 4.8' },
  { provider: 'openai', id: 'gpt-5.6', label: 'OpenAI GPT-5.6' },
  { provider: 'openai', id: 'gpt-5.6-terra', label: 'OpenAI GPT-5.6 Terra' },
  { provider: 'openai', id: 'gpt-5.6-luna', label: 'OpenAI GPT-5.6 Luna' },
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
