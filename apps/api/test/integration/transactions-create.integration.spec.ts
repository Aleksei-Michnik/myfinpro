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
 * Phase 6.5 / 6.18.1.1 — POST /transactions integration tests.
 *
 * Bootstraps the real AppModule against the test DB and exercises the endpoint
 * end-to-end: auth, validation, category resolution, attribution scoping,
 * transaction, audit log.
 *
 * Iteration 6.18.1.1 adds three RECURRING-related cases (12, 13, 14) — they
 * need a real Redis (the schedule sub-resource POST upserts a BullMQ scheduler
 * key), so this suite spins up a Redis testcontainer mirroring the existing
 * `transaction-schedule.integration.spec.ts` setup. The minimum-interval policy
 * floor is dropped to ~100 ms via `TRANSACTION_SCHEDULE_MIN_INTERVAL_MS` so the
 * two-step test can use a tiny `everyMs` value without hitting the production
 * 60 s floor.
 */
describe('POST /transactions (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: Queue;
  let redis: StartedTestContainer;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let groupId: string;
  let outCategoryId: string;
  let inCategoryId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  // Save the surrounding env so we can restore it in afterAll — otherwise our
  // testcontainer-pointing REDIS_HOST/PORT leak into sibling integration
  // suites running afterwards in the same Jest worker.
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
    // Allow tiny intervals so the two-step create test doesn't have to wait
    // for the production 60 s floor.
    process.env.TRANSACTION_SCHEDULE_MIN_INTERVAL_MS = '100';

    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    queue = app.get(getQueueToken(TRANSACTION_OCCURRENCES_QUEUE));

    await seedSystemCategories(prisma);

    alice = await registerUser(app, `pay-a-${suffix}@test.local`);
    bob = await registerUser(app, `pay-b-${suffix}@test.local`);

    // Alice creates a group; Bob is NOT a member.
    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'Pay Fam', type: 'family' })
      .expect(201);
    groupId = groupRes.body.id;

    const outCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    });
    const inCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'IN' },
    });
    outCategoryId = outCat!.id;
    inCategoryId = inCat!.id;
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

  afterEach(async () => {
    // Schedules cascade-delete with their parent transaction, but we tear down
    // attributions first explicitly so the test snapshot stays predictable
    // even when a test creates a RECURRING parent + schedule.
    await prisma.transactionSchedule.deleteMany({});
    await prisma.transactionAttribution.deleteMany({});
    await prisma.transaction.deleteMany({
      where: { createdById: { in: [alice.user.id, bob.user.id] } },
    });
  });

  const basePayload = (over: Record<string, unknown> = {}) => ({
    direction: 'OUT',
    type: 'ONE_TIME',
    amountCents: 1250,
    currency: 'USD',
    occurredAt: '2026-04-25',
    categoryId: outCategoryId,
    attributions: [{ scope: 'personal' }],
    ...over,
  });

  it('1. creates a personal ONE_TIME transaction', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ note: 'groceries run' }))
      .expect(201);

    expect(res.body).toEqual(
      expect.objectContaining({
        direction: 'OUT',
        type: 'ONE_TIME',
        amountCents: 1250,
        currency: 'USD',
        status: 'POSTED',
        note: 'groceries run',
        createdById: alice.user.id,
      }),
    );

    const transactions = await prisma.transaction.findMany({
      where: { createdById: alice.user.id },
      include: { attributions: true },
    });
    expect(transactions).toHaveLength(1);
    expect(transactions[0].attributions).toHaveLength(1);
    expect(transactions[0].attributions[0]).toEqual(
      expect.objectContaining({
        scopeType: 'personal',
        userId: alice.user.id,
        groupId: null,
      }),
    );
  });

  it('2. creates a group ONE_TIME transaction when caller is a member', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ attributions: [{ scope: 'group', groupId }] }))
      .expect(201);

    expect(res.body.attributions[0]).toEqual(
      expect.objectContaining({ scope: 'group', groupId, userId: null }),
    );

    const row = await prisma.transactionAttribution.findFirst({
      where: { transactionId: res.body.id },
    });
    expect(row).toEqual(expect.objectContaining({ scopeType: 'group', groupId, userId: null }));
  });

  it('3. creates a mixed personal + group attribution transaction', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(
        basePayload({
          attributions: [{ scope: 'personal' }, { scope: 'group', groupId }],
        }),
      )
      .expect(201);

    const rows = await prisma.transactionAttribution.findMany({
      where: { transactionId: res.body.id },
    });
    expect(rows).toHaveLength(2);
  });

  it('4. rejects IN transaction with an OUT category (direction mismatch)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ direction: 'IN', categoryId: outCategoryId }))
      .expect(400);

    expect(res.body.errorCode).toBe('TRANSACTION_CATEGORY_DIRECTION_MISMATCH');
  });

  it('4b. accepts IN transaction with an IN category (sanity)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ direction: 'IN', categoryId: inCategoryId }))
      .expect(201);
  });

  it('5. rejects group attribution from a non-member (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send(basePayload({ attributions: [{ scope: 'group', groupId }] }))
      .expect(403);

    expect(res.body.errorCode).toBe('TRANSACTION_ATTRIBUTION_OUT_OF_SCOPE');
  });

  it('6. rejects duplicate attributions', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ attributions: [{ scope: 'personal' }, { scope: 'personal' }] }))
      .expect(400);

    expect(res.body.errorCode).toBe('TRANSACTION_DUPLICATE_ATTRIBUTION');
  });

  it('7. rejects a far-future occurredAt', async () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ occurredAt: future }))
      .expect(400);

    expect(res.body.errorCode).toBe('TRANSACTION_INVALID_DATE');
  });

  it('8. rejects type=INSTALLMENT without a plan body (plans shipped in 6.20)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ type: 'INSTALLMENT' }))
      .expect(400);

    expect(res.body.errorCode).toBe('TRANSACTION_PLAN_REQUIRED');
  });

  it('9. rejects ONE_TIME with a schedule body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ schedule: { frequency: 'MONTHLY', interval: 1 } }))
      .expect(400);

    expect(res.body.errorCode).toBe('TRANSACTION_SCHEDULE_NOT_SUPPORTED');
  });

  it('10. writes a TRANSACTION_CREATED audit log on success', async () => {
    const before = await prisma.auditLog.count({
      where: { action: 'TRANSACTION_CREATED', userId: alice.user.id },
    });

    await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload())
      .expect(201);

    // Audit is best-effort, fired off the main promise — give it a tick to land.
    await new Promise((res) => setTimeout(res, 50));

    const after = await prisma.auditLog.count({
      where: { action: 'TRANSACTION_CREATED', userId: alice.user.id },
    });
    expect(after).toBe(before + 1);
  });

  it('11. rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).post('/api/v1/transactions').send(basePayload()).expect(401);
  });

  // ── iteration 6.18.1.1: type=RECURRING is now accepted on create ──

  it('12. accepts type=RECURRING and persists the row WITHOUT a schedule', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ type: 'RECURRING', note: 'monthly rent' }))
      .expect(201);

    expect(res.body).toEqual(
      expect.objectContaining({
        type: 'RECURRING',
        amountCents: 1250,
        currency: 'USD',
        status: 'POSTED',
        createdById: alice.user.id,
      }),
    );

    // The DB row exists with type=RECURRING and NO TransactionSchedule attached
    // — the web client posts that as a separate request.
    const persisted = await prisma.transaction.findUnique({
      where: { id: res.body.id },
      include: { schedule: true },
    });
    expect(persisted).not.toBeNull();
    expect(persisted!.type).toBe('RECURRING');
    expect(persisted!.schedule).toBeNull();

    // Audit log fires the same as ONE_TIME, with type=RECURRING in details.
    await new Promise((r) => setTimeout(r, 50));
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'TRANSACTION_CREATED', entityId: res.body.id, userId: alice.user.id },
    });
    expect(audit).not.toBeNull();
    expect((audit!.details as { type?: string }).type).toBe('RECURRING');
  });

  it('13. two-step create: POST /transactions (RECURRING) then POST /transactions/:id/schedule → 201', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ type: 'RECURRING' }))
      .expect(201);

    const scheduleRes = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${created.body.id}/schedule`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ everyMs: 60_000, limit: 2 })
      .expect(201);

    expect(scheduleRes.body).toEqual(
      expect.objectContaining({
        transactionId: created.body.id,
        everyMs: 60_000,
        limit: 2,
      }),
    );

    const schedule = await prisma.transactionSchedule.findUnique({
      where: { transactionId: created.body.id },
    });
    expect(schedule).not.toBeNull();
  });

  it('14. RECURRING create then DELETE the transaction → 200 (transactionDeleted); no orphan schedule remains', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ type: 'RECURRING' }))
      .expect(201);

    // No schedule was created (asserted defensively — the create flow must
    // never auto-create one; that is the web client's second POST).
    const before = await prisma.transactionSchedule.findUnique({
      where: { transactionId: created.body.id },
    });
    expect(before).toBeNull();

    // The DELETE endpoint returns 200 + an AttributionChangeResultDto with
    // `transactionDeleted: true` when the last accessible attribution is removed.
    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${created.body.id}?scope=personal`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(deleted.body.transactionDeleted).toBe(true);

    const transaction = await prisma.transaction.findUnique({ where: { id: created.body.id } });
    expect(transaction).toBeNull();
    const orphanSchedule = await prisma.transactionSchedule.findUnique({
      where: { transactionId: created.body.id },
    });
    expect(orphanSchedule).toBeNull();
  });
});
