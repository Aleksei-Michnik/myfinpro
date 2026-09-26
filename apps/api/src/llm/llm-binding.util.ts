import { LLM_DEFAULT_MODEL, LLM_PROVIDERS, type LlmProvider } from '@myfinpro/shared';

export interface LlmBinding {
  /**
   * Raw user value when it comes from the selection — the catalog check stays
   * in the caller, which owns the user-facing "model retired" message.
   */
  provider: string;
  model: string;
  source: 'selection' | 'credential';
}

/**
 * Phase 8.11-hotfix — what a user's extraction should run on, before keys are
 * resolved: an explicit selection wins; otherwise a stored personal key is an
 * explicit intent to use that provider, with its default model (first provider
 * in LLM_PROVIDERS order when several keys exist); null = the deployment
 * default binding decides.
 *
 * A key stored without ever calling `PUT /llm/selection` used to be ignored,
 * which silently ran the deployment default (the mock in production) on the
 * uploader's receipts.
 */
export function pickLlmBinding(input: {
  llmProvider: string | null | undefined;
  llmModel: string | null | undefined;
  credentialProviders: readonly string[];
}): LlmBinding | null {
  // Half a selection is no selection — the settings endpoint writes both
  // columns together, so a single one is leftover/partial state.
  if (input.llmProvider && input.llmModel) {
    return { provider: input.llmProvider, model: input.llmModel, source: 'selection' };
  }

  const stored = LLM_PROVIDERS.find((p: LlmProvider) => input.credentialProviders.includes(p));
  if (stored) {
    return { provider: stored, model: LLM_DEFAULT_MODEL[stored], source: 'credential' };
  }
  return null;
}
