import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { seedSystemCategories } from '../../src/payment/seed-system-categories';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 6.17.3 — full producer + worker integration spec.
 *
 * Boots a fresh Redis testcontainer, drops the `everyMs` floor to 200 ms via
 * `PAYMENT_SCHEDULE_MIN_INTERVAL_MS`, creates a `RECURRING` parent payment
 * with a personal + group attribution, posts a schedule, and waits for the
 * worker to materialise child Payments.
 *
 * Production minimum stays at 60 000 ms (asserted by the production-default
 * branch in the unit suite).
 */
describe('PaymentOccurrence worker (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
    // Drop the floor so the test can poll for ≥ 2 firings within the
    // suite-level 30s budget. Production minimum stays at 60_000 ms.
    process.env.PAYMENT_SCHEDULE_MIN_INTERVAL_MS = '200';

    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    user = await registerUser(app, `occ-${suffix}@test.local`);

    const outCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    });
    outCategoryId = outCat!.id;
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    if (redis) await redis.stop();
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 30_000);

  async function createRecurringParent(
    extraAttributions: Array<{
      scopeType: string;
      userId: string | null;
      groupId: string | null;
    }> = [],
  ) {
    return prisma.payment.create({
      data: {
        direction: 'OUT',
        type: 'RECURRING',
        amountCents: 4242,
        currency: 'USD',
        occurredAt: new Date(),
        status: 'POSTED',
        categoryId: outCategoryId,
        note: 'subscription',
        createdById: user.user.id,
        attributions: {
          create: [{ scopeType: 'personal', userId: user.user.id }, ...extraAttributions],
        },
      },
    });
  }

  async function waitForOccurrences(
    parentId: string,
    count: number,
    timeoutMs = 10_000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const got = await prisma.payment.count({ where: { parentPaymentId: parentId } });
      if (got >= count) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `Timed out waiting for ${count} occurrences on parent ${parentId} (got ${await prisma.payment.count(
        { where: { parentPaymentId: parentId } },
      )})`,
    );
  }

  it('produces 2 child Payments with cloned attributions, audit logs, and updated lastRunAt; DELETE stops further firings', async () => {
    const parent = await createRecurringParent();

    // Schedule with everyMs=1500, limit=2 — under the test-only floor
    // (200 ms) but spaced enough to clear BullMQ's repeat-loop poll cadence
    // so both fires happen within the 20s wait budget.
    const scheduleRes = await request(app.getHttpServer())
      .post(`/api/v1/payments/${parent.id}/schedule`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ everyMs: 1500, limit: 2 })
      .expect(201);

    const scheduleId = scheduleRes.body.id as string;

    await waitForOccurrences(parent.id, 2, 20_000);

    const occurrences = await prisma.payment.findMany({
      where: { parentPaymentId: parent.id },
      include: { attributions: true },
      orderBy: { occurredAt: 'asc' },
    });

    expect(occurrences).toHaveLength(2);
    for (const occ of occurrences) {
      expect(occ.type).toBe('ONE_TIME');
      expect(occ.parentPaymentId).toBe(parent.id);
      expect(occ.amountCents).toBe(parent.amountCents);
      expect(occ.currency).toBe(parent.currency);
      expect(occ.categoryId).toBe(parent.categoryId);
      expect(occ.note).toBe(parent.note);
      expect(occ.createdById).toBe(parent.createdById);
      expect(occ.idempotencyKey).toMatch(new RegExp(`^${scheduleId}:\\d+$`));
      expect(occ.attributions).toHaveLength(1);
      expect(occ.attributions[0].scopeType).toBe('personal');
      expect(occ.attributions[0].userId).toBe(user.user.id);
    }

    // Distinct idempotency keys.
    const keys = new Set(occurrences.map((o) => o.idempotencyKey));
    expect(keys.size).toBe(2);

    // Schedule lastRunAt + nextRunAt updated.
    const sched = await prisma.paymentSchedule.findUnique({ where: { id: scheduleId } });
    expect(sched?.lastRunAt).not.toBeNull();
    expect(sched?.nextRunAt).not.toBeNull();

    // Audit logs.
    const audits = await prisma.auditLog.findMany({
      where: { action: 'PAYMENT_OCCURRENCE_CREATED', entityId: parent.id },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);

    // DELETE stops further firings.
    await request(app.getHttpServer())
      .delete(`/api/v1/payments/${parent.id}/schedule`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(204);

    const countAfterDelete = await prisma.payment.count({ where: { parentPaymentId: parent.id } });
    await new Promise((r) => setTimeout(r, 1500));
    const countAfterWait = await prisma.payment.count({ where: { parentPaymentId: parent.id } });
    expect(countAfterWait).toBe(countAfterDelete);
  }, 30_000);
});
