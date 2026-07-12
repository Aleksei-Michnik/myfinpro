import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 8.11 — per-user LLM settings integration tests (runbook §9).
 *
 * Exercises the security-relevant surface against the real AppModule:
 * catalog availability, selection validation, encrypted-at-rest credential
 * storage (the DB row must carry only the v1 envelope + last-4 hint),
 * hint-only reads, and per-user isolation. Shared provider keys are blanked
 * and the live key probe is disabled so nothing leaves the test network.
 */
describe('Per-user LLM settings (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: StartedTestContainer;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const openaiKey = `sk-proj-${'a1b2c3d4'.repeat(6)}`;

  const originalEnv = {
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS_TLS: process.env.REDIS_TLS,
    LLM_SECRETS_ENCRYPTION_KEY: process.env.LLM_SECRETS_ENCRYPTION_KEY,
    LLM_KEY_LIVE_VALIDATION: process.env.LLM_KEY_LIVE_VALIDATION,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  beforeAll(async () => {
    redis = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withCommand(['redis-server', '--appendonly', 'no'])
      .start();
    process.env.REDIS_HOST = redis.getHost();
    process.env.REDIS_PORT = String(redis.getMappedPort(6379));
    process.env.REDIS_PASSWORD = '';
    process.env.REDIS_TLS = 'false';
    // Deterministic availability: no shared provider keys, BYOK only.
    process.env.ANTHROPIC_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    process.env.LLM_SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.LLM_KEY_LIVE_VALIDATION = 'false'; // no external calls

    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    alice = await registerUser(app, `llm-a-${suffix}@test.local`);
    bob = await registerUser(app, `llm-b-${suffix}@test.local`);
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    if (redis) await redis.stop();
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 30_000);

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('serves the catalog with everything unavailable when no keys exist', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/llm/catalog')
      .set(auth(alice.accessToken))
      .expect(200);

    expect(res.body.models.length).toBeGreaterThanOrEqual(6);
    expect(res.body.models.every((m: { available: boolean }) => !m.available)).toBe(true);
    expect(res.body.selection).toBeNull();
    expect(res.body.credentials).toEqual([]);
    expect(res.body.sharedProviders).toEqual([]);
  });

  it('rejects selecting a model whose provider has no usable key', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/v1/llm/selection')
      .set(auth(alice.accessToken))
      .send({ provider: 'openai', model: 'gpt-5.6' })
      .expect(400);
    expect(res.body.errorCode).toBe('LLM_PROVIDER_UNAVAILABLE');
  });

  it('stores a key encrypted at rest, exposes only the hint, and unlocks selection', async () => {
    const put = await request(app.getHttpServer())
      .put('/api/v1/llm/credentials/openai')
      .set(auth(alice.accessToken))
      .send({ apiKey: openaiKey })
      .expect(200);
    expect(put.body.credential.keyHint).toBe(openaiKey.slice(-4));
    expect(JSON.stringify(put.body)).not.toContain(openaiKey);

    // At rest: versioned AES-GCM envelope, no plaintext anywhere in the row.
    const row = await prisma.userLlmCredential.findUnique({
      where: { userId_provider: { userId: alice.user.id, provider: 'openai' } },
    });
    expect(row).not.toBeNull();
    expect(row!.encryptedValue).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain(openaiKey);
    expect(row!.keyHint).toBe(openaiKey.slice(-4));

    // Reads are hint-only.
    const list = await request(app.getHttpServer())
      .get('/api/v1/llm/credentials')
      .set(auth(alice.accessToken))
      .expect(200);
    expect(list.body.credentials).toHaveLength(1);
    expect(list.body.credentials[0]).not.toHaveProperty('encryptedValue');

    // Selection now allowed; catalog reflects both.
    await request(app.getHttpServer())
      .put('/api/v1/llm/selection')
      .set(auth(alice.accessToken))
      .send({ provider: 'openai', model: 'gpt-5.6' })
      .expect(200);
    const catalog = await request(app.getHttpServer())
      .get('/api/v1/llm/catalog')
      .set(auth(alice.accessToken))
      .expect(200);
    expect(catalog.body.selection).toEqual({ provider: 'openai', model: 'gpt-5.6' });
    expect(catalog.body.models.find((m: { id: string }) => m.id === 'gpt-5.6').available).toBe(
      true,
    );
  });

  it('rejects malformed keys, unknown pairs and unknown providers', async () => {
    const badKey = await request(app.getHttpServer())
      .put('/api/v1/llm/credentials/anthropic')
      .set(auth(alice.accessToken))
      .send({ apiKey: 'definitely-not-an-anthropic-key' })
      .expect(400);
    expect(badKey.body.errorCode).toBe('LLM_INVALID_API_KEY');

    const badPair = await request(app.getHttpServer())
      .put('/api/v1/llm/selection')
      .set(auth(alice.accessToken))
      .send({ provider: 'anthropic', model: 'gpt-5.6' })
      .expect(400);
    expect(badPair.body.errorCode).toBe('LLM_INVALID_MODEL');

    await request(app.getHttpServer())
      .put('/api/v1/llm/credentials/gemini')
      .set(auth(alice.accessToken))
      .send({ apiKey: openaiKey })
      .expect(400);
  });

  it("keeps users isolated — bob never sees alice's credentials", async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/llm/catalog')
      .set(auth(bob.accessToken))
      .expect(200);
    expect(res.body.credentials).toEqual([]);
    expect(res.body.models.every((m: { available: boolean }) => !m.available)).toBe(true);
  });

  it('clears the selection with a null pair and deletes credentials', async () => {
    const cleared = await request(app.getHttpServer())
      .put('/api/v1/llm/selection')
      .set(auth(alice.accessToken))
      .send({ provider: null, model: null })
      .expect(200);
    expect(cleared.body.selection).toBeNull();

    await request(app.getHttpServer())
      .delete('/api/v1/llm/credentials/openai')
      .set(auth(alice.accessToken))
      .expect(204);
    await request(app.getHttpServer())
      .delete('/api/v1/llm/credentials/openai')
      .set(auth(alice.accessToken))
      .expect(404);
  });
});
