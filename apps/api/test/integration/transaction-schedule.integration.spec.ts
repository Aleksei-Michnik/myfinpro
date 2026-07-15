import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TRANSACTION_OCCURRENCES_QUEUE } from '../../src/queue/queue.constants';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 6.17.2 — schedule CRUD integration test.
 *
 * Boots a fresh Redis testcontainer, points the app at it via env vars
 * (BullMQ + RedisHealthIndicator share the same connection), and exercises
 * the full flow:
 *
 *  - Register a user, create a RECURRING transaction with the existing
 *    POST /transactions path.
 *  - POST a schedule with `everyMs: 60_000` + `limit: 2`.
 *  - Assert the DB row exists, and the BullMQ scheduler is registered under
 *    `transaction-schedule:<id>`.
 *  - DELETE removes both.
 *
 * Worker side-effects (no-op processor logs) are asserted in 6.17.3 — this
 * iteration just proves the producer + Redis mirror work end-to-end.
 */
describe('TransactionSchedule CRUD (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: Queue;
  let redis: StartedTestContainer;

  let user: Awaited<ReturnType<typeof registerUser>>;
  let outCategoryId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  // Save the surrounding env so we can restore it in afterAll — otherwise our
  // testcontainer-pointing REDIS_HOST/PORT leak into sibling integration
  // suites running afterwards in the same Jest worker.
  const originalRedisEnv = {
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS_TLS: process.env.REDIS_TLS,
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

    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    queue = app.get(getQueueToken(TRANSACTION_OCCURRENCES_QUEUE));

    await seedSystemCategories(prisma);

    user = await registerUser(app, `sched-${suffix}@test.local`);

    const outCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    });
    outCategoryId = outCat!.id;
  }, 120_000);

  afterAll(async () => {
    if (queue) await queue.close().catch(() => undefined);
    if (app) await app.close();
    if (redis) await redis.stop();
    // Restore env to whatever the surrounding harness expected.
    for (const [k, v] of Object.entries(originalRedisEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 30_000);

  async function createParentTransaction(type: 'ONE_TIME' | 'RECURRING') {
    // The 6.5 endpoint only accepts ONE_TIME; we insert RECURRING parents
    // directly via Prisma so this iteration's tests don't need to wait for
    // the 6.17 RECURRING branch of POST /transactions.
    return prisma.transaction.create({
      data: {
        direction: 'OUT',
        type,
        amountCents: 1000,
        currency: 'USD',
        occurredAt: new Date(),
        status: 'POSTED',
        categoryId: outCategoryId,
        createdById: user.user.id,
        attributions: {
          create: [{ scopeType: 'personal', userId: user.user.id }],
        },
      },
    });
  }

  it('POST → DB row + Redis scheduler key; DELETE removes both', async () => {
    const parent = await createParentTransaction('RECURRING');

    // POST
    const created = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${parent.id}/schedule`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ everyMs: 60_000, limit: 2 })
      .expect(201);

    expect(created.body.id).toBeDefined();

    // Row exists.
    const row = await prisma.transactionSchedule.findUnique({
      where: { transactionId: parent.id },
    });
    expect(row).not.toBeNull();
    expect(row?.everyMs).toBe(60_000);
    expect(row?.limit).toBe(2);

    // BullMQ scheduler registered.
    const schedulers = await queue.getJobSchedulers();
    const ours = schedulers.find((s) => s.key === `transaction-schedule:${created.body.id}`);
    expect(ours).toBeDefined();
    // BullMQ returns `every` as either a number or a string depending on
    // the version — coerce both ends to string for a robust assertion.
    expect(String(ours?.every)).toBe('60000');

    // DELETE
    await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${parent.id}/schedule`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(204);

    const rowAfter = await prisma.transactionSchedule.findUnique({
      where: { transactionId: parent.id },
    });
    expect(rowAfter).toBeNull();

    const schedulersAfter = await queue.getJobSchedulers();
    expect(
      schedulersAfter.find((s) => s.key === `transaction-schedule:${created.body.id}`),
    ).toBeUndefined();
  }, 60_000);

  it('rejects POST on a ONE_TIME parent with TRANSACTION_SCHEDULE_PARENT_NOT_RECURRING (409)', async () => {
    const parent = await createParentTransaction('ONE_TIME');
    const res = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${parent.id}/schedule`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ everyMs: 60_000 })
      .expect(409);
    expect(res.body.errorCode).toBe('TRANSACTION_SCHEDULE_PARENT_NOT_RECURRING');
  });

  it('PUT replaces the spec idempotently (same scheduler key, new opts)', async () => {
    const parent = await createParentTransaction('RECURRING');

    const created = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${parent.id}/schedule`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ everyMs: 60_000 })
      .expect(201);
    const id = created.body.id as string;

    await request(app.getHttpServer())
      .put(`/api/v1/transactions/${parent.id}/schedule`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ cron: '*/2 * * * *' })
      .expect(200);

    const row = await prisma.transactionSchedule.findUnique({
      where: { transactionId: parent.id },
    });
    expect(row?.id).toBe(id); // same row
    expect(row?.cron).toBe('*/2 * * * *');
    expect(row?.everyMs).toBeNull();

    const schedulers = await queue.getJobSchedulers();
    const ours = schedulers.find((s) => s.key === `transaction-schedule:${id}`);
    expect(ours).toBeDefined();
    expect(ours?.pattern).toBe('*/2 * * * *');

    // Cleanup
    await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${parent.id}/schedule`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(204);
  }, 60_000);
});
