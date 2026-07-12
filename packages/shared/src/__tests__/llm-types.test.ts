import { describe, expect, it } from 'vitest';
import {
  findLlmModel,
  isLlmProvider,
  LLM_API_KEY_PATTERNS,
  LLM_MODEL_CATALOG,
  LLM_PROVIDERS,
} from '../types/llm.types';

describe('LLM catalog', () => {
  it('every model belongs to a known provider and ids are unique', () => {
    const seen = new Set<string>();
    for (const model of LLM_MODEL_CATALOG) {
      expect(LLM_PROVIDERS).toContain(model.provider);
      expect(model.label.length).toBeGreaterThan(0);
      const key = `${model.provider}:${model.id}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('offers models for both launch providers', () => {
    expect(LLM_MODEL_CATALOG.some((m) => m.provider === 'anthropic')).toBe(true);
    expect(LLM_MODEL_CATALOG.some((m) => m.provider === 'openai')).toBe(true);
  });

  it('findLlmModel resolves catalog pairs and rejects everything else', () => {
    expect(findLlmModel('anthropic', 'claude-sonnet-5')?.label).toContain('Sonnet');
    expect(findLlmModel('openai', 'claude-sonnet-5')).toBeNull();
    expect(findLlmModel('anthropic', 'gpt-5.6')).toBeNull();
    expect(findLlmModel('gemini', 'gemini-pro')).toBeNull();
  });

  it('isLlmProvider narrows only known providers', () => {
    expect(isLlmProvider('anthropic')).toBe(true);
    expect(isLlmProvider('openai')).toBe(true);
    expect(isLlmProvider('gemini')).toBe(false);
    expect(isLlmProvider('')).toBe(false);
  });
});

describe('LLM API key patterns', () => {
  const anthropicKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
  const openaiKey = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';

  it('accepts well-formed provider keys', () => {
    expect(LLM_API_KEY_PATTERNS.anthropic.test(anthropicKey)).toBe(true);
    expect(LLM_API_KEY_PATTERNS.openai.test(openaiKey)).toBe(true);
  });

  it('rejects cross-provider and malformed keys', () => {
    // An Anthropic key pasted into the OpenAI slot must fail the shape gate.
    expect(LLM_API_KEY_PATTERNS.openai.test(anthropicKey)).toBe(false);
    expect(LLM_API_KEY_PATTERNS.anthropic.test(openaiKey)).toBe(false);
    expect(LLM_API_KEY_PATTERNS.anthropic.test('sk-ant-short')).toBe(false);
    expect(LLM_API_KEY_PATTERNS.openai.test('sk-has spaces in it aaaaaaaaaa')).toBe(false);
    expect(LLM_API_KEY_PATTERNS.openai.test('')).toBe(false);
  });
});
