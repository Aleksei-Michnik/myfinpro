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
 * Phase 6.17.4 — schedule cascade integration test.
 *
 * Verifies that producer-side cleanup happens immediately on:
 *   - Parent transaction edited RECURRING → ONE_TIME (cascade tear-down)
 *   - Parent transaction hard-deleted via DELETE ?scope=all (cascade tear-down
 *     before the FK cascade)
 *
 * Boots Redis via testcontainers; TRANSACTION_SCHEDULE_MIN_INTERVAL_MS=100 so
 * we can use sub-minute intervals.
 */
describe('TransactionSchedule cascade (integration)', () => {
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
    TRANSACTION_SCHEDULE_MIN_INTERVAL_MS: process.env.TRANSACTION_SCHEDULE_MIN_INTERVAL_MS,
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
    process.env.TRANSACTION_SCHEDULE_MIN_INTERVAL_MS = '100';

    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    queue = app.get(getQueueToken(TRANSACTION_OCCURRENCES_QUEUE));

    await seedSystemCategories(prisma);
    user = await registerUser(app, `cascade-${suffix}@test.local`);
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
    return prisma.transaction.create({
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
    return all.some((s) => s.key === `transaction-schedule:${scheduleId}`);
  }

  it('cascade on parent RECURRING → ONE_TIME tears down schedule + scheduler + audit reason=parent_type_changed', async () => {
    const parent = await createParentRecurring();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${parent.id}/schedule`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ everyMs: 1000 })
      .expect(201);
    const scheduleId = created.body.id as string;
    expect(await schedulerKeyExists(scheduleId)).toBe(true);

    // PATCH parent to ONE_TIME
    await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${parent.id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ type: 'ONE_TIME' })
      .expect(200);

    // Schedule row gone.
    const row = await prisma.transactionSchedule.findUnique({
      where: { transactionId: parent.id },
    });
    expect(row).toBeNull();
    // Scheduler key gone.
    expect(await schedulerKeyExists(scheduleId)).toBe(false);

    // Audit log present with reason.
    const audits = await prisma.auditLog.findMany({
      where: {
        entity: 'TransactionSchedule',
        action: 'TRANSACTION_SCHEDULE_DELETED',
        entityId: parent.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audits.length).toBeGreaterThan(0);
    const details = audits[0].details as { reason?: string };
    expect(details.reason).toBe('parent_type_changed');
  }, 60_000);

  it('cascade on parent DELETE ?scope=all tears down schedule + scheduler before parent.delete', async () => {
    const parent = await createParentRecurring();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${parent.id}/schedule`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ everyMs: 1000 })
      .expect(201);
    const scheduleId = created.body.id as string;
    expect(await schedulerKeyExists(scheduleId)).toBe(true);

    await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${parent.id}?scope=all`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);

    // Both row and parent gone.
    const row = await prisma.transactionSchedule.findFirst({ where: { id: scheduleId } });
    expect(row).toBeNull();
    const transaction = await prisma.transaction.findUnique({ where: { id: parent.id } });
    expect(transaction).toBeNull();

    expect(await schedulerKeyExists(scheduleId)).toBe(false);
  }, 60_000);
});
