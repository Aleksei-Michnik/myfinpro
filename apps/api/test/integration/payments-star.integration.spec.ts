import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedSystemCategories } from '../../src/payment/seed-system-categories';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 6.9 — POST /payments/:id/star integration tests.
 *
 * Covers per-user toggle behaviour, multi-user star count, the 6.6 list
 * `starred=true|false` filter, the `starredByMe` field on GET /payments/:id,
 * cascade on payment delete, and the audit log trail.
 */
describe('POST /payments/:id/star (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let carol: Awaited<ReturnType<typeof registerUser>>;
  let groupId: string;
  let outCategoryId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const createPayment = async (
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string }> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    return res.body;
  };

  const toggleStar = async (
    token: string,
    paymentId: string,
  ): Promise<{
    status: number;
    body: { starred?: boolean; starCount?: number; errorCode?: string };
  }> => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentId}/star`)
      .set('Authorization', `Bearer ${token}`);
    return { status: res.status, body: res.body };
  };

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    alice = await registerUser(app, `star-a-${suffix}@test.local`);
    bob = await registerUser(app, `star-b-${suffix}@test.local`);
    carol = await registerUser(app, `star-c-${suffix}@test.local`);

    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'Star Fam', type: 'family' })
      .expect(201);
    groupId = groupRes.body.id;
    await prisma.groupMembership.create({
      data: { groupId, userId: carol.user.id, role: 'member' },
    });

    const outCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    });
    outCategoryId = outCat!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await prisma.paymentStar.deleteMany({});
    await prisma.paymentAttribution.deleteMany({});
    await prisma.payment.deleteMany({
      where: { createdById: { in: [alice.user.id, bob.user.id, carol.user.id] } },
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

  // ── 1. First toggle = star on ──

  it('1. first toggle returns { starred: true, starCount: 1 }', async () => {
    const { id } = await createPayment(alice.accessToken, basePayload());
    const r = await toggleStar(alice.accessToken, id);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ starred: true, starCount: 1 });
  });

  // ── 2. Second toggle = star off ──

  it('2. second toggle by same user returns { starred: false, starCount: 0 }', async () => {
    const { id } = await createPayment(alice.accessToken, basePayload());
    await toggleStar(alice.accessToken, id);
    const r = await toggleStar(alice.accessToken, id);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ starred: false, starCount: 0 });

    // DB reflects deletion.
    const rows = await prisma.paymentStar.findMany({ where: { paymentId: id } });
    expect(rows).toHaveLength(0);
  });

  // ── 3. Two users star the same payment ──

  it('3. two users star the same group payment → starCount=2 after second call', async () => {
    const { id } = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );

    const r1 = await toggleStar(alice.accessToken, id);
    expect(r1.body).toEqual({ starred: true, starCount: 1 });

    const r2 = await toggleStar(carol.accessToken, id);
    expect(r2.body).toEqual({ starred: true, starCount: 2 });
  });

  // ── 4. starredByMe on GET /:id is per-user ──

  it('4. GET /payments/:id reflects per-user starredByMe after starring', async () => {
    const { id } = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );
    await toggleStar(alice.accessToken, id);

    const aliceGet = await request(app.getHttpServer())
      .get(`/api/v1/payments/${id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(aliceGet.body.starredByMe).toBe(true);

    const carolGet = await request(app.getHttpServer())
      .get(`/api/v1/payments/${id}`)
      .set('Authorization', `Bearer ${carol.accessToken}`)
      .expect(200);
    expect(carolGet.body.starredByMe).toBe(false);
  });

  // ── 5. Non-visible payment 404 ──

  it("5. user without visibility toggling another user's personal payment → 404", async () => {
    const { id } = await createPayment(alice.accessToken, basePayload());
    const r = await toggleStar(bob.accessToken, id);
    expect(r.status).toBe(404);
    expect(r.body.errorCode).toBe('PAYMENT_NOT_FOUND');

    // No star row was created.
    const rows = await prisma.paymentStar.findMany({ where: { paymentId: id } });
    expect(rows).toHaveLength(0);
  });

  // ── 6. Group payment: creator + member each star ──

  it('6. creator A and member C each star a group payment → both see starredByMe=true; starCount=2', async () => {
    const { id } = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );
    const r1 = await toggleStar(alice.accessToken, id);
    expect(r1.body.starred).toBe(true);

    const r2 = await toggleStar(carol.accessToken, id);
    expect(r2.body).toEqual({ starred: true, starCount: 2 });

    const aliceGet = await request(app.getHttpServer())
      .get(`/api/v1/payments/${id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(aliceGet.body.starredByMe).toBe(true);

    const carolGet = await request(app.getHttpServer())
      .get(`/api/v1/payments/${id}`)
      .set('Authorization', `Bearer ${carol.accessToken}`)
      .expect(200);
    expect(carolGet.body.starredByMe).toBe(true);
  });

  // ── 7. List filter ?starred=true|false ──

  it('7. GET /payments?starred=true returns only the caller-starred payment', async () => {
    const p1 = await createPayment(alice.accessToken, basePayload({ amountCents: 100 }));
    await createPayment(alice.accessToken, basePayload({ amountCents: 200 }));
    await toggleStar(alice.accessToken, p1.id);

    const starredRes = await request(app.getHttpServer())
      .get('/api/v1/payments?starred=true')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(starredRes.body.data).toHaveLength(1);
    expect(starredRes.body.data[0].id).toBe(p1.id);
    expect(starredRes.body.data[0].starredByMe).toBe(true);

    const unstarredRes = await request(app.getHttpServer())
      .get('/api/v1/payments?starred=false')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(unstarredRes.body.data).toHaveLength(1);
    expect(unstarredRes.body.data[0].id).not.toBe(p1.id);
  });

  // ── 8. Cascade ──

  it('8. payment delete cascades and removes PaymentStar rows', async () => {
    const { id } = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );
    await toggleStar(alice.accessToken, id);
    await toggleStar(carol.accessToken, id);

    const before = await prisma.paymentStar.findMany({ where: { paymentId: id } });
    expect(before).toHaveLength(2);

    // Hard-delete via DELETE ?scope=all (creator removes the only group attribution).
    await request(app.getHttpServer())
      .delete(`/api/v1/payments/${id}?scope=all`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);

    const after = await prisma.paymentStar.findMany({ where: { paymentId: id } });
    expect(after).toHaveLength(0);
  });

  // ── 9. Audit log trail ──

  it('9. toggle on + off writes PAYMENT_STARRED then PAYMENT_UNSTARRED audit rows', async () => {
    const { id } = await createPayment(alice.accessToken, basePayload());
    await toggleStar(alice.accessToken, id);
    await toggleStar(alice.accessToken, id);

    // Allow async fire-and-forget audits to settle.
    await new Promise((res) => setTimeout(res, 100));

    const audits = await prisma.auditLog.findMany({
      where: {
        entity: 'Payment',
        entityId: id,
        action: { in: ['PAYMENT_STARRED', 'PAYMENT_UNSTARRED'] },
        userId: alice.user.id,
      },
      orderBy: { createdAt: 'asc' },
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toEqual(['PAYMENT_STARRED', 'PAYMENT_UNSTARRED']);
  });
});
