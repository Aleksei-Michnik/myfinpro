import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { LLM_ERRORS } from './constants/llm-errors';
import type { LlmCredentialsService } from './llm-credentials.service';
import { LlmSettingsService } from './llm-settings.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('LlmSettingsService', () => {
  const prismaMock = {
    user: { findUniqueOrThrow: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    userLlmCredential: { count: jest.fn().mockResolvedValue(0) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const credentialsMock = { listCredentials: jest.fn().mockResolvedValue([]) };

  const makeService = (env: Record<string, string> = {}) =>
    new LlmSettingsService(
      prismaMock as unknown as PrismaService,
      { get: (key: string) => env[key] } as unknown as ConfigService,
      credentialsMock as unknown as LlmCredentialsService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ llmProvider: null, llmModel: null });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.userLlmCredential.count.mockResolvedValue(0);
    credentialsMock.listCredentials.mockResolvedValue([]);
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  it('marks models available from a shared deployment key or a user key', async () => {
    credentialsMock.listCredentials.mockResolvedValue([
      { provider: 'openai', keyHint: 'cdef', updatedAt: new Date() },
    ]);
    const catalog = await makeService({ ANTHROPIC_API_KEY: 'sk-ant-shared' }).getCatalog('u1');

    expect(catalog.sharedProviders).toEqual(['anthropic']);
    expect(catalog.models.every((m) => m.available)).toBe(true);
    expect(catalog.selection).toBeNull();
    expect(catalog.credentials).toHaveLength(1);
  });

  it('marks everything unavailable with no keys anywhere', async () => {
    const catalog = await makeService().getCatalog('u1');
    expect(catalog.models.some((m) => m.available)).toBe(false);
  });

  it('surfaces the stored selection', async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-5',
    });
    const catalog = await makeService().getCatalog('u1');
    expect(catalog.selection).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
  });

  it('rejects a half-null selection and unknown catalog pairs', async () => {
    const service = makeService();
    await expect(service.updateSelection('u1', 'anthropic', null)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.updateSelection('u1', 'anthropic', 'gpt-5.6')).rejects.toMatchObject({
      response: { errorCode: LLM_ERRORS.LLM_INVALID_MODEL },
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects selecting a provider with no usable key', async () => {
    await expect(makeService().updateSelection('u1', 'openai', 'gpt-5.6')).rejects.toMatchObject({
      response: { errorCode: LLM_ERRORS.LLM_PROVIDER_UNAVAILABLE },
    });
  });

  it('accepts a selection backed by a user key and audits it', async () => {
    prismaMock.userLlmCredential.count.mockResolvedValue(1);
    const selection = await makeService().updateSelection('u1', 'openai', 'gpt-5.6');
    expect(selection).toEqual({ provider: 'openai', model: 'gpt-5.6' });
    expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({
      llmProvider: 'openai',
      llmModel: 'gpt-5.6',
    });
    expect(prismaMock.auditLog.create.mock.calls[0][0].data.action).toBe('LLM_SELECTION_UPDATED');
  });

  it('clears the selection with a null pair', async () => {
    const selection = await makeService().updateSelection('u1', null, null);
    expect(selection).toBeNull();
    expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({
      llmProvider: null,
      llmModel: null,
    });
    expect(prismaMock.auditLog.create.mock.calls[0][0].data.details).toEqual({ cleared: true });
  });
});
