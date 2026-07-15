import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 6 · Iteration 6.19 — plans API integration.
 *
 * Full HTTP round-trips against real MySQL:
 *   - POST /transactions with type=INSTALLMENT (0%, 12×) pre-generates 12 PENDING
 *     children of exactly $100 (design acceptance).
 *   - POST /transactions with type=LOAN (5%, 60×) matches the spreadsheet
 *     reference ($188.71 annuity).
 *   - GET /transactions/:id/plan returns the joined amortisation table.
 *   - DELETE /transactions/:id/plan cancels terminally (children flip to
 *     CANCELLED, repeat delete 409s, non-creator 404s).
 */
describe('POST /transactions + /transactions/:id/plan (plans, integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let outCategoryId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    alice = await registerUser(app, `plan-a-${suffix}@test.local`);
    bob = await registerUser(app, `plan-b-${suffix}@test.local`);

    const outCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    });
    outCategoryId = outCat!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.transactionAttribution.deleteMany({});
    await prisma.transactionPlan.deleteMany({});
    await prisma.transaction.deleteMany({
      where: { createdById: { in: [alice.user.id, bob.user.id] } },
    });
  });

  const planBody = (over: Record<string, unknown> = {}) => ({
    direction: 'OUT',
    type: 'INSTALLMENT',
    amountCents: 120_000,
    currency: 'USD',
    occurredAt: new Date().toISOString(),
    categoryId: outCategoryId,
    attributions: [{ scope: 'personal' }],
    plan: {
      interestRate: 0,
      transactionsCount: 12,
      frequency: 'MONTHLY',
      firstDueAt: '2026-08-01T00:00:00.000Z',
    },
    ...over,
  });

  const createPlan = async (body: Record<string, unknown> = planBody()) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(body)
      .expect(201);
    return res.body as { id: string };
  };

  it('INSTALLMENT $1200 / 12 @ 0% → parent + 12 PENDING children of exactly $100', async () => {
    const created = await createPlan();

    const children = await prisma.transaction.findMany({
      where: { parentTransactionId: created.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(children).toHaveLength(12);
    for (const child of children) {
      expect(child.amountCents).toBe(10_000);
      expect(child.status).toBe('PENDING');
      expect(child.type).toBe('ONE_TIME');
      expect(child.currency).toBe('USD');
    }
    // Monthly cadence anchored to the first due date.
    expect(children[0].occurredAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(children[11].occurredAt.toISOString()).toBe('2027-07-01T00:00:00.000Z');
    // Children clone the personal attribution.
    const attrs = await prisma.transactionAttribution.findMany({
      where: { transactionId: children[0].id },
    });
    expect(attrs).toEqual([
      expect.objectContaining({ scopeType: 'personal', userId: alice.user.id }),
    ]);
    // Plan row persisted with derived principal + default method.
    const plan = await prisma.transactionPlan.findUnique({ where: { transactionId: created.id } });
    expect(plan).toEqual(
      expect.objectContaining({
        kind: 'INSTALLMENT',
        principalCents: 120_000,
        transactionsCount: 12,
        amortizationMethod: 'equal',
        cancelledAt: null,
      }),
    );
  });

  it('LOAN $10,000 / 60 @ 5% → french annuity matching the spreadsheet reference', async () => {
    const created = await createPlan(
      planBody({
        type: 'LOAN',
        amountCents: 1_000_000,
        plan: {
          interestRate: 0.05,
          transactionsCount: 60,
          frequency: 'MONTHLY',
          firstDueAt: '2026-08-01T00:00:00.000Z',
        },
      }),
    );

    const res = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${created.id}/plan`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);

    expect(res.body.kind).toBe('LOAN');
    expect(res.body.amortizationMethod).toBe('french');
    expect(res.body.rows).toHaveLength(60);
    // Reference: $188.71 constant annuity, $41.67 first-month interest.
    expect(res.body.rows[0].totalCents).toBe(18_871);
    expect(res.body.rows[0].interestCents).toBe(4_167);
    expect(res.body.rows[59].remainingCents).toBe(0);
    // Every row is backed by a real PENDING child.
    for (const row of res.body.rows) {
      expect(row.occurrenceId).toEqual(expect.any(String));
      expect(row.status).toBe('PENDING');
    }
    // Child amounts equal the row totals (last row absorbs rounding).
    const children = await prisma.transaction.findMany({
      where: { parentTransactionId: created.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(children).toHaveLength(60);
    expect(children[0].amountCents).toBe(18_871);
    expect(children[59].amountCents).toBe(res.body.rows[59].totalCents);
  });

  it('plan body on a non-plan type → 400 TRANSACTION_PLAN_NOT_SUPPORTED; plan kind without body → 400 TRANSACTION_PLAN_REQUIRED', async () => {
    const notSupported = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(planBody({ type: 'ONE_TIME' }))
      .expect(400);
    expect(notSupported.body.errorCode).toBe('TRANSACTION_PLAN_NOT_SUPPORTED');

    const required = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(planBody({ plan: undefined }))
      .expect(400);
    expect(required.body.errorCode).toBe('TRANSACTION_PLAN_REQUIRED');
  });

  it('DELETE cancels terminally: children flip to CANCELLED, repeat 409s, non-creator 404s', async () => {
    const created = await createPlan();

    // Non-creator (Bob) cannot cancel — 404, nothing changes.
    await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${created.id}/plan`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(404);

    const res = await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${created.id}/plan`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(res.body.cancelledAt).toEqual(expect.any(String));
    expect(res.body.rows.every((r: { status: string }) => r.status === 'CANCELLED')).toBe(true);

    const children = await prisma.transaction.findMany({
      where: { parentTransactionId: created.id },
    });
    expect(children).toHaveLength(12); // never deleted
    expect(children.every((c) => c.status === 'CANCELLED')).toBe(true);

    await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${created.id}/plan`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(409);
  });

  it('GET requires visibility: strangers 404, plan-less transactions 404', async () => {
    const created = await createPlan();

    await request(app.getHttpServer())
      .get(`/api/v1/transactions/${created.id}/plan`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(404);

    const oneTime = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send(planBody({ type: 'ONE_TIME', plan: undefined }))
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${oneTime.body.id}/plan`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(404);
    expect(res.body.errorCode).toBe('TRANSACTION_PLAN_NOT_FOUND');
  });
});
