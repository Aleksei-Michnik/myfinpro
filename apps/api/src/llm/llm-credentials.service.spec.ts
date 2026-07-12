import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { LlmCredentialsService } from './llm-credentials.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('LlmCredentialsService', () => {
  const masterKey = randomBytes(32).toString('base64');
  const anthropicKey = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234';

  const prismaMock = {
    userLlmCredential: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const configWith = (values: Record<string, string | undefined>) =>
    ({
      get: (key: string, def?: string) => values[key] ?? def,
    }) as unknown as ConfigService;

  const makeService = (env: Record<string, string | undefined> = {}) =>
    new LlmCredentialsService(
      prismaMock as unknown as PrismaService,
      configWith({
        LLM_SECRETS_ENCRYPTION_KEY: masterKey,
        LLM_KEY_LIVE_VALIDATION: 'false',
        ...env,
      }),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.userLlmCredential.upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'cred-1', updatedAt: new Date(), ...create }),
    );
  });

  it('rejects keys failing the provider shape gate without touching the DB', async () => {
    await expect(makeService().setCredential('u1', 'anthropic', 'not-a-key')).rejects.toThrow(
      BadRequestException,
    );
    // Cross-provider paste: an anthropic key in the openai slot.
    await expect(makeService().setCredential('u1', 'openai', anthropicKey)).rejects.toThrow(
      BadRequestException,
    );
    expect(prismaMock.userLlmCredential.upsert).not.toHaveBeenCalled();
  });

  it('stores only the encrypted envelope and hint; audits hint-only', async () => {
    const result = await makeService().setCredential('u1', 'anthropic', anthropicKey);

    const { create } = prismaMock.userLlmCredential.upsert.mock.calls[0][0];
    expect(create.encryptedValue).toMatch(/^v1:/);
    expect(create.encryptedValue).not.toContain(anthropicKey);
    expect(create.keyHint).toBe(anthropicKey.slice(-4));
    expect(result.keyHint).toBe(anthropicKey.slice(-4));
    expect(result).not.toHaveProperty('encryptedValue');

    const audit = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('LLM_CREDENTIAL_SET');
    expect(JSON.stringify(audit)).not.toContain(anthropicKey);
  });

  describe('save-time live probe', () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
      global.fetch = fetchMock as unknown as typeof fetch;
    });

    it('rejects keys the provider rejects (401)', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401 });
      const service = makeService({ LLM_KEY_LIVE_VALIDATION: undefined });
      await expect(service.setCredential('u1', 'anthropic', anthropicKey)).rejects.toThrow(
        /rejected/,
      );
      expect(fetchMock.mock.calls[0][0]).toContain('api.anthropic.com');
      expect(prismaMock.userLlmCredential.upsert).not.toHaveBeenCalled();
    });

    it('accepts keys when the probe cannot run (network trouble is not proof)', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const service = makeService({ LLM_KEY_LIVE_VALIDATION: undefined });
      await expect(service.setCredential('u1', 'anthropic', anthropicKey)).resolves.toBeDefined();
    });
  });

  it('listCredentials never selects the encrypted value', async () => {
    prismaMock.userLlmCredential.findMany.mockResolvedValue([]);
    await makeService().listCredentials('u1');
    expect(prismaMock.userLlmCredential.findMany.mock.calls[0][0].select).toEqual({
      provider: true,
      keyHint: true,
      updatedAt: true,
    });
  });

  it('deleteCredential 404s when nothing is stored, audits when it deletes', async () => {
    prismaMock.userLlmCredential.deleteMany.mockResolvedValue({ count: 0 });
    await expect(makeService().deleteCredential('u1', 'openai')).rejects.toThrow(NotFoundException);

    prismaMock.userLlmCredential.deleteMany.mockResolvedValue({ count: 1 });
    await makeService().deleteCredential('u1', 'openai');
    expect(prismaMock.auditLog.create.mock.calls[0][0].data.action).toBe('LLM_CREDENTIAL_DELETED');
  });

  it('resolveApiKey decrypts what setCredential stored (single boundary roundtrip)', async () => {
    const service = makeService();
    await service.setCredential('u1', 'anthropic', anthropicKey);
    const { create } = prismaMock.userLlmCredential.upsert.mock.calls[0][0];
    prismaMock.userLlmCredential.findUnique.mockResolvedValue({
      encryptedValue: create.encryptedValue,
    });
    await expect(service.resolveApiKey('u1', 'anthropic')).resolves.toBe(anthropicKey);
  });

  it('resolveApiKey degrades to null on missing rows or undecryptable data', async () => {
    const service = makeService();
    prismaMock.userLlmCredential.findUnique.mockResolvedValue(null);
    await expect(service.resolveApiKey('u1', 'anthropic')).resolves.toBeNull();

    prismaMock.userLlmCredential.findUnique.mockResolvedValue({ encryptedValue: 'v1:AAA:BBB:CCC' });
    await expect(service.resolveApiKey('u1', 'anthropic')).resolves.toBeNull();
  });

  it('without a master key: writes 503, resolution returns null, production boot fails', async () => {
    const unconfigured = makeService({ LLM_SECRETS_ENCRYPTION_KEY: undefined });
    expect(unconfigured.storageConfigured).toBe(false);
    await expect(unconfigured.setCredential('u1', 'anthropic', anthropicKey)).rejects.toThrow(
      ServiceUnavailableException,
    );
    await expect(unconfigured.resolveApiKey('u1', 'anthropic')).resolves.toBeNull();

    expect(() =>
      makeService({ LLM_SECRETS_ENCRYPTION_KEY: undefined, NODE_ENV: 'production' }),
    ).toThrow(/required in production/);
  });
});
