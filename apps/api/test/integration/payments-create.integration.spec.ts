import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedSystemCategories } from '../../src/payment/seed-system-categories';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 6.5 — POST /payments integration tests (ONE_TIME only).
 *
 * Bootstraps the real AppModule against the test DB and exercises the endpoint
 * end-to-end: auth, validation, category resolution, attribution scoping,
 * transaction, audit log.
 */
describe('POST /payments (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let groupId: string;
  let outCategoryId: string;
  let inCategoryId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

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
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.paymentAttribution.deleteMany({});
    await prisma.payment.deleteMany({
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

  it('1. creates a personal ONE_TIME payment', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
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

    const payments = await prisma.payment.findMany({
      where: { createdById: alice.user.id },
      include: { attributions: true },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].attributions).toHaveLength(1);
    expect(payments[0].attributions[0]).toEqual(
      expect.objectContaining({
        scopeType: 'personal',
        userId: alice.user.id,
        groupId: null,
      }),
    );
  });

  it('2. creates a group ONE_TIME payment when caller is a member', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ attributions: [{ scope: 'group', groupId }] }))
      .expect(201);

    expect(res.body.attributions[0]).toEqual(
      expect.objectContaining({ scope: 'group', groupId, userId: null }),
    );

    const row = await prisma.paymentAttribution.findFirst({
      where: { paymentId: res.body.id },
    });
    expect(row).toEqual(expect.objectContaining({ scopeType: 'group', groupId, userId: null }));
  });

  it('3. creates a mixed personal + group attribution payment', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(
        basePayload({
          attributions: [{ scope: 'personal' }, { scope: 'group', groupId }],
        }),
      )
      .expect(201);

    const rows = await prisma.paymentAttribution.findMany({
      where: { paymentId: res.body.id },
    });
    expect(rows).toHaveLength(2);
  });

  it('4. rejects IN payment with an OUT category (direction mismatch)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ direction: 'IN', categoryId: outCategoryId }))
      .expect(400);

    expect(res.body.errorCode).toBe('PAYMENT_CATEGORY_DIRECTION_MISMATCH');
  });

  it('4b. accepts IN payment with an IN category (sanity)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ direction: 'IN', categoryId: inCategoryId }))
      .expect(201);
  });

  it('5. rejects group attribution from a non-member (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send(basePayload({ attributions: [{ scope: 'group', groupId }] }))
      .expect(403);

    expect(res.body.errorCode).toBe('PAYMENT_ATTRIBUTION_OUT_OF_SCOPE');
  });

  it('6. rejects duplicate attributions', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ attributions: [{ scope: 'personal' }, { scope: 'personal' }] }))
      .expect(400);

    expect(res.body.errorCode).toBe('PAYMENT_DUPLICATE_ATTRIBUTION');
  });

  it('7. rejects a far-future occurredAt', async () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ occurredAt: future }))
      .expect(400);

    expect(res.body.errorCode).toBe('PAYMENT_INVALID_DATE');
  });

  it('8. rejects type=RECURRING with PAYMENT_TYPE_NOT_IMPLEMENTED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ type: 'RECURRING' }))
      .expect(400);

    expect(res.body.errorCode).toBe('PAYMENT_TYPE_NOT_IMPLEMENTED');
  });

  it('9. rejects ONE_TIME with a schedule body', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload({ schedule: { frequency: 'MONTHLY', interval: 1 } }))
      .expect(400);

    expect(res.body.errorCode).toBe('PAYMENT_SCHEDULE_NOT_SUPPORTED');
  });

  it('10. writes a PAYMENT_CREATED audit log on success', async () => {
    const before = await prisma.auditLog.count({
      where: { action: 'PAYMENT_CREATED', userId: alice.user.id },
    });

    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(basePayload())
      .expect(201);

    // Audit is best-effort, fired off the main promise — give it a tick to land.
    await new Promise((res) => setTimeout(res, 50));

    const after = await prisma.auditLog.count({
      where: { action: 'PAYMENT_CREATED', userId: alice.user.id },
    });
    expect(after).toBe(before + 1);
  });

  it('11. rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).post('/api/v1/payments').send(basePayload()).expect(401);
  });
});
