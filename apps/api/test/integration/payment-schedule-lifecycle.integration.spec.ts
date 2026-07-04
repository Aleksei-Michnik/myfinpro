import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { seedSystemCategories } from '../../src/payment/seed-system-categories';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PAYMENT_OCCURRENCES_QUEUE } from '../../src/queue/queue.constants';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 6.17.4 — schedule lifecycle (pause / resume / cancel) integration test.
 *
 * Boots Redis via testcontainers, drops the schedule-min-interval floor to
 * 100 ms so we can observe firings within a single test, and exercises:
 *   - active → paused → active → cancelled state machine
 *   - 409 idempotency guards on every transition
 *   - Redis scheduler key presence/absence at each step
 */
describe('PaymentSchedule lifecycle (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: Queue;
  let redis: StartedTestContainer;

  let user: Awaited<ReturnType<typeof registerUser>>;
  let outCategoryId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const originalEnv = {
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS_TLS: process.env.REDIS_TLS,
    PAYMENT_SCHEDULE_MIN_INTERVAL_MS: process.env.PAYMENT_SCHEDULE_MIN_INTERVAL_MS,
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
    process.env.PAYMENT_SCHEDULE_MIN_INTERVAL_MS = '100';

    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    queue = app.get(getQueueToken(PAYMENT_OCCURRENCES_QUEUE));

    await seedSystemCategories(prisma);
    user = await registerUser(app, `lifecycle-${suffix}@test.local`);
    const outCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    });
    outCategoryId = outCat!.id;
  }, 120_000);

  afterAll(async () => {
    if (queue) await queue.close().catch(() => undefined);
    if (app) await app.close();
    if (redis) await redis.stop();
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 30_000);

  async function createParentRecurring(): Promise<{ id: string }> {
    return prisma.payment.create({
      data: {
        direction: 'OUT',
        type: 'RECURRING',
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

  async function schedulerKeyExists(scheduleId: string): Promise<boolean> {
    const all = await queue.getJobSchedulers();
    return all.some((s) => s.key === `payment-schedule:${scheduleId}`);
  }

  it('pause → resume → cancel state machine + idempotency guards', async () => {
    const parent = await createParentRecurring();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/payments/${parent.id}/schedule`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ everyMs: 1000 })
      .expect(201);
    const scheduleId = created.body.id as string;

    expect(await schedulerKeyExists(scheduleId)).toBe(true);

    // ── pause ──
    const paused = await request(app.getHttpServer())
      .post(`/api/v1/payments/${parent.id}/schedule/pause`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(paused.body.pausedAt).not.toBeNull();
    expect(paused.body.cancelledAt).toBeNull();
    expect(await schedulerKeyExists(scheduleId)).toBe(false);

    // pause again → 409
    const pauseAgain = await request(app.getHttpServer())
      .post(`/api/v1/payments/${parent.id}/schedule/pause`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(409);
    expect(pauseAgain.body.errorCode).toBe('PAYMENT_SCHEDULE_ALREADY_PAUSED');

    // ── resume ──
    const resumed = await request(app.getHttpServer())
      .post(`/api/v1/payments/${parent.id}/schedule/resume`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(resumed.body.pausedAt).toBeNull();
    expect(await schedulerKeyExists(scheduleId)).toBe(true);

    // resume again → 409 NOT_PAUSED
    const resumeAgain = await request(app.getHttpServer())
      .post(`/api/v1/payments/${parent.id}/schedule/resume`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(409);
    expect(resumeAgain.body.errorCode).toBe('PAYMENT_SCHEDULE_NOT_PAUSED');

    // ── cancel ──
    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/payments/${parent.id}/schedule/cancel`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(cancelled.body.cancelledAt).not.toBeNull();
    expect(await schedulerKeyExists(scheduleId)).toBe(false);

    // Row preserved.
    const row = await prisma.paymentSchedule.findUnique({ where: { paymentId: parent.id } });
    expect(row).not.toBeNull();
    expect(row?.cancelledAt).not.toBeNull();

    // cancel again → 409 ALREADY_CANCELLED
    const cancelAgain = await request(app.getHttpServer())
      .post(`/api/v1/payments/${parent.id}/schedule/cancel`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(409);
    expect(cancelAgain.body.errorCode).toBe('PAYMENT_SCHEDULE_ALREADY_CANCELLED');

    // pause on cancelled → 409 CANCELLED
    const pauseCancelled = await request(app.getHttpServer())
      .post(`/api/v1/payments/${parent.id}/schedule/pause`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(409);
    expect(pauseCancelled.body.errorCode).toBe('PAYMENT_SCHEDULE_CANCELLED');

    // resume on cancelled → 409 CANCELLED
    const resumeCancelled = await request(app.getHttpServer())
      .post(`/api/v1/payments/${parent.id}/schedule/resume`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(409);
    expect(resumeCancelled.body.errorCode).toBe('PAYMENT_SCHEDULE_CANCELLED');
  }, 60_000);
});
