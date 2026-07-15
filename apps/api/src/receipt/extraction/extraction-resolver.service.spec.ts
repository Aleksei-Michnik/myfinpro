import type { ConfigService } from '@nestjs/config';
import type { LlmCredentialsService } from '../../llm/llm-credentials.service';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  ExtractionFailedError,
  type ReceiptExtractionProvider,
} from './extraction-provider.interface';
import { ExtractionResolverService } from './extraction-resolver.service';
import { ResilientExtractionProvider } from './resilient-extraction.provider';

describe('ExtractionResolverService', () => {
  const prismaMock = { user: { findUnique: jest.fn() } };
  const credentialsMock = { resolveApiKey: jest.fn() };
  const defaultProvider: ReceiptExtractionProvider = { name: 'mock', extract: jest.fn() };

  const makeService = (env: Record<string, string> = {}) =>
    new ExtractionResolverService(
      prismaMock as unknown as PrismaService,
      { get: (key: string) => env[key] } as unknown as ConfigService,
      credentialsMock as unknown as LlmCredentialsService,
      defaultProvider,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    credentialsMock.resolveApiKey.mockResolvedValue(null);
  });

  it('returns the deployment default binding when the user has no selection', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ llmProvider: null, llmModel: null });
    const resolved = await makeService().resolveForUser('u1');
    expect(resolved.provider).toBe(defaultProvider);
    expect(resolved.keySource).toBe('default');
    expect(resolved.model).toBeNull();
  });

  it("prefers the user's own key over the shared one", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-5',
    });
    credentialsMock.resolveApiKey.mockResolvedValue('sk-ant-user-key');
    const resolved = await makeService({ ANTHROPIC_API_KEY: 'sk-ant-shared' }).resolveForUser('u1');
    expect(resolved.keySource).toBe('user');
    expect(resolved.providerName).toBe('anthropic');
    expect(resolved.model).toBe('claude-sonnet-5');
    expect(resolved.provider).toBeInstanceOf(ResilientExtractionProvider);
  });

  it('falls back to the shared deployment key', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ llmProvider: 'openai', llmModel: 'gpt-5.6' });
    const resolved = await makeService({ OPENAI_API_KEY: 'sk-shared' }).resolveForUser('u1');
    expect(resolved.keySource).toBe('shared');
    expect(resolved.provider.name).toBe('openai');
  });

  it('fails permanently (with a settings-facing message) when no key exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ llmProvider: 'openai', llmModel: 'gpt-5.6' });
    await expect(makeService().resolveForUser('u1')).rejects.toThrow(ExtractionFailedError);
    await expect(makeService().resolveForUser('u1')).rejects.toThrow(/add one in settings/i);
  });

  it('fails permanently when the selected model left the catalog', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      llmProvider: 'anthropic',
      llmModel: 'claude-1-retired',
    });
    await expect(makeService().resolveForUser('u1')).rejects.toThrow(/no longer available/i);
  });

  it('reuses one instance per (provider, model, key) so breaker state is coherent', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-5',
    });
    credentialsMock.resolveApiKey.mockResolvedValue('sk-ant-user-key');
    const service = makeService();
    const first = await service.resolveForUser('u1');
    const second = await service.resolveForUser('u1');
    expect(second.provider).toBe(first.provider);

    // A rotated key must produce a fresh client.
    credentialsMock.resolveApiKey.mockResolvedValue('sk-ant-rotated-key');
    const third = await service.resolveForUser('u1');
    expect(third.provider).not.toBe(first.provider);
  });
});
