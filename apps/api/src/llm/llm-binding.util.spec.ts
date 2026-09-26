import { LLM_DEFAULT_MODEL } from '@myfinpro/shared';
import { pickLlmBinding } from './llm-binding.util';

describe('pickLlmBinding', () => {
  it('prefers an explicit selection over stored credentials', () => {
    expect(
      pickLlmBinding({
        llmProvider: 'openai',
        llmModel: 'gpt-5.6-terra',
        credentialProviders: ['anthropic', 'openai'],
      }),
    ).toEqual({ provider: 'openai', model: 'gpt-5.6-terra', source: 'selection' });
  });

  it("falls back to a stored key's provider with its default model", () => {
    expect(
      pickLlmBinding({
        llmProvider: null,
        llmModel: null,
        credentialProviders: ['openai'],
      }),
    ).toEqual({ provider: 'openai', model: LLM_DEFAULT_MODEL.openai, source: 'credential' });
  });

  it('prefers anthropic when keys for both providers are stored (LLM_PROVIDERS order)', () => {
    expect(
      pickLlmBinding({
        llmProvider: null,
        llmModel: null,
        credentialProviders: ['openai', 'anthropic'],
      }),
    ).toEqual({
      provider: 'anthropic',
      model: LLM_DEFAULT_MODEL.anthropic,
      source: 'credential',
    });
  });

  it('returns null when there is neither a selection nor a stored key', () => {
    expect(
      pickLlmBinding({ llmProvider: null, llmModel: null, credentialProviders: [] }),
    ).toBeNull();
    expect(
      pickLlmBinding({ llmProvider: undefined, llmModel: undefined, credentialProviders: [] }),
    ).toBeNull();
  });

  it('treats half a selection as no selection', () => {
    expect(
      pickLlmBinding({ llmProvider: 'anthropic', llmModel: null, credentialProviders: [] }),
    ).toBeNull();
    expect(
      pickLlmBinding({ llmProvider: null, llmModel: 'claude-sonnet-5', credentialProviders: [] }),
    ).toBeNull();
    // …and still lets a stored key decide.
    expect(
      pickLlmBinding({
        llmProvider: 'anthropic',
        llmModel: null,
        credentialProviders: ['anthropic'],
      }),
    ).toEqual({
      provider: 'anthropic',
      model: LLM_DEFAULT_MODEL.anthropic,
      source: 'credential',
    });
  });

  it('ignores credential rows for providers outside the catalog', () => {
    expect(
      pickLlmBinding({ llmProvider: null, llmModel: null, credentialProviders: ['gemini'] }),
    ).toBeNull();
  });
});
