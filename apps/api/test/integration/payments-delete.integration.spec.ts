import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedSystemCategories } from '../../src/payment/seed-system-categories';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 6.8 — DELETE /payments/:id + PATCH /payments/:id with attributions.
 *
 * Covers scope resolution (personal / group:<id> / all / implicit),
 * ambiguity detection, non-visible 404 masking, non-creator gate on
 * attribution edits, hard-delete cascade (stars + comments), and audit
 * rows (PAYMENT_ATTRIBUTION_REMOVED / PAYMENT_DELETED).
 */
describe('DELETE + PATCH(attributions) /payments/:id (integration)', () => {
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
  ): Promise<{ id: string; [k: string]: unknown }> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    return res.body;
  };

  const del = async (token: string, id: string, scope?: string) => {
    const q = scope ? `?scope=${encodeURIComponent(scope)}` : '';
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/payments/${id}${q}`)
      .set('Authorization', `Bearer ${token}`);
    return { status: res.status, body: res.body };
  };

  const patch = async (token: string, id: string, body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/payments/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    return { status: res.status, body: res.body };
  };

  const getOne = async (token: string, id: string) => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/payments/${id}`)
      .set('Authorization', `Bearer ${token}`);
    return { status: res.status, body: res.body };
  };

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    alice = await registerUser(app, `del-a-${suffix}@test.local`);
    bob = await registerUser(app, `del-b-${suffix}@test.local`);
    carol = await registerUser(app, `del-c-${suffix}@test.local`);

    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'Del Fam', type: 'family' })
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
    await prisma.auditLog.deleteMany({ where: { entity: 'Payment' } });
    await prisma.paymentStar.deleteMany({});
    await prisma.paymentComment.deleteMany({});
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

  // 1. DELETE ?scope=personal on personal-only payment → payment deleted.
  it('1. DELETE ?scope=personal on personal-only payment → paymentDeleted=true', async () => {
    const c = await createPayment(alice.accessToken, basePayload());
    const { status, body } = await del(alice.accessToken, c.id, 'personal');
    expect(status).toBe(200);
    expect(body.paymentDeleted).toBe(true);
    expect(body.deletedAttributions).toBe(1);
    const row = await prisma.payment.findUnique({ where: { id: c.id } });
    expect(row).toBeNull();
  });

  // 2. DELETE ?scope=personal on mixed → only personal removed; payment remains.
  it('2. DELETE ?scope=personal on mixed payment → only personal removed', async () => {
    const c = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'personal' }, { scope: 'group', groupId }] }),
    );
    const { status, body } = await del(alice.accessToken, c.id, 'personal');
    expect(status).toBe(200);
    expect(body.paymentDeleted).toBe(false);
    expect(body.deletedAttributions).toBe(1);
    // GET still works.
    const g = await getOne(alice.accessToken, c.id);
    expect(g.status).toBe(200);
    expect(g.body.attributions).toHaveLength(1);
    expect(g.body.attributions[0].scope).toBe('group');
  });

  // 3. DELETE ?scope=group:<id> as member (carol) → group attribution removed.
  it('3. DELETE ?scope=group:<id> as member removes that attribution', async () => {
    const c = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'personal' }, { scope: 'group', groupId }] }),
    );
    const { status, body } = await del(carol.accessToken, c.id, `group:${groupId}`);
    expect(status).toBe(200);
    expect(body.paymentDeleted).toBe(false);
    expect(body.deletedAttributions).toBe(1);
    // Alice still sees it (personal attr survives).
    const g = await getOne(alice.accessToken, c.id);
    expect(g.status).toBe(200);
  });

  // 4. DELETE ?scope=group:<id> as non-member bob → 404.
  it('4. DELETE ?scope=group:<id> as non-member → 404', async () => {
    const c = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );
    const { status, body } = await del(bob.accessToken, c.id, `group:${groupId}`);
    expect(status).toBe(404);
    expect(body.errorCode).toBe('PAYMENT_NOT_FOUND');
  });

  // 5. DELETE ?scope=all on personal+group → both removed, payment deleted.
  it('5. DELETE ?scope=all on a mixed payment removes everything → paymentDeleted', async () => {
    const c = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'personal' }, { scope: 'group', groupId }] }),
    );
    const { status, body } = await del(alice.accessToken, c.id, 'all');
    expect(status).toBe(200);
    expect(body.paymentDeleted).toBe(true);
    expect(body.deletedAttributions).toBe(2);
    const row = await prisma.payment.findUnique({ where: { id: c.id } });
    expect(row).toBeNull();
  });

  // 6. DELETE ?scope=all preserves another user's accessible attribution.
  //    Alice creates a group payment where carol also has a personal attribution
  //    (edge case: typically the creator's personal attribution is theirs, so
  //    to simulate "another user's personal on the same payment" we insert it
  //    directly through prisma).
  it("6. DELETE ?scope=all keeps other users' accessible attributions", async () => {
    const c = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'personal' }, { scope: 'group', groupId }] }),
    );
    // Attach carol's personal attribution directly.
    await prisma.paymentAttribution.create({
      data: {
        paymentId: c.id,
        scopeType: 'personal',
        userId: carol.user.id,
        groupId: null,
      },
    });
    // Alice DELETEs ?scope=all — should remove only alice's personal + the group attrib
    // (both accessible). carol's personal survives, so payment survives.
    const { status, body } = await del(alice.accessToken, c.id, 'all');
    expect(status).toBe(200);
    expect(body.paymentDeleted).toBe(false);
    expect(body.deletedAttributions).toBe(2);
    // Carol can still see the payment.
    const g = await getOne(carol.accessToken, c.id);
    expect(g.status).toBe(200);
  });

  // 7. Implicit scope on ambiguous → 409 PAYMENT_SCOPE_AMBIGUOUS.
  it('7. DELETE without scope on ambiguous → 409 PAYMENT_SCOPE_AMBIGUOUS', async () => {
    const c = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'personal' }, { scope: 'group', groupId }] }),
    );
    const { status, body } = await del(alice.accessToken, c.id);
    expect(status).toBe(409);
    expect(body.errorCode).toBe('PAYMENT_SCOPE_AMBIGUOUS');
    expect(body.details?.accessibleScopes).toEqual(
      expect.arrayContaining(['personal', `group:${groupId}`]),
    );
  });

  // 8. DELETE ?scope=personal when caller has only group attribution → 409.
  it('8. DELETE ?scope=personal when user has no personal → 409 PAYMENT_SCOPE_NOT_ATTRIBUTED', async () => {
    const c = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );
    // Alice has only a group attribution on this payment.
    const { status, body } = await del(alice.accessToken, c.id, 'personal');
    expect(status).toBe(409);
    expect(body.errorCode).toBe('PAYMENT_SCOPE_NOT_ATTRIBUTED');
  });

  // 9. PATCH attributions=[] on personal-only → 204, payment hard-deleted.
  it('9. PATCH attributions=[] on personal-only → 204 + GET 404', async () => {
    const c = await createPayment(alice.accessToken, basePayload());
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/payments/${c.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ attributions: [] });
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    const g = await getOne(alice.accessToken, c.id);
    expect(g.status).toBe(404);
  });

  // 10. PATCH replaces [group:X] → [personal].
  it('10. PATCH attributions=[personal] on group-only → adds personal, removes group', async () => {
    const c = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );
    const { status, body } = await patch(alice.accessToken, c.id, {
      attributions: [{ scope: 'personal' }],
    });
    expect(status).toBe(200);
    expect(body.attributions).toHaveLength(1);
    expect(body.attributions[0].scope).toBe('personal');
  });

  // 11. PATCH with non-member group → 403.
  it('11. PATCH with non-member group in desired → 403 PAYMENT_ATTRIBUTION_OUT_OF_SCOPE', async () => {
    const c = await createPayment(alice.accessToken, basePayload());
    // Make a second group that Bob owns and Alice is not in.
    const otherGroup = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({ name: 'Bob Group', type: 'family' })
      .expect(201);

    const { status, body } = await patch(alice.accessToken, c.id, {
      attributions: [{ scope: 'personal' }, { scope: 'group', groupId: otherGroup.body.id }],
    });
    expect(status).toBe(403);
    expect(body.errorCode).toBe('PAYMENT_ATTRIBUTION_OUT_OF_SCOPE');
  });

  // 12. Non-creator member PATCH with attributions only → 403 PAYMENT_NOT_OWNER.
  it('12. non-creator (group member) PATCH attributions → 403 PAYMENT_NOT_OWNER', async () => {
    const c = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );
    const { status, body } = await patch(carol.accessToken, c.id, {
      attributions: [{ scope: 'personal' }],
    });
    expect(status).toBe(403);
    expect(body.errorCode).toBe('PAYMENT_NOT_OWNER');
  });

  // 13. Audit rows on a full DELETE.
  it('13. full DELETE writes PAYMENT_ATTRIBUTION_REMOVED (N) + PAYMENT_DELETED audit rows', async () => {
    const c = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'personal' }, { scope: 'group', groupId }] }),
    );
    await del(alice.accessToken, c.id, 'all');
    // allow fire-and-forget audit to settle
    await new Promise((res) => setTimeout(res, 150));
    const audits = await prisma.auditLog.findMany({
      where: { entity: 'Payment', entityId: c.id },
    });
    const actions = audits.map((a) => a.action);
    expect(actions.filter((a) => a === 'PAYMENT_ATTRIBUTION_REMOVED')).toHaveLength(2);
    expect(actions).toContain('PAYMENT_DELETED');
  });

  // 14. Cascade: stars + comments gone on hard-delete.
  it('14. DELETE cascades to payment_stars and payment_comments', async () => {
    const c = await createPayment(alice.accessToken, basePayload());
    await prisma.paymentStar.create({ data: { paymentId: c.id, userId: alice.user.id } });
    await prisma.paymentComment.create({
      data: { paymentId: c.id, userId: alice.user.id, content: 'will die' },
    });

    const { status, body } = await del(alice.accessToken, c.id, 'all');
    expect(status).toBe(200);
    expect(body.paymentDeleted).toBe(true);

    const stars = await prisma.paymentStar.findMany({ where: { paymentId: c.id } });
    const comments = await prisma.paymentComment.findMany({ where: { paymentId: c.id } });
    expect(stars).toHaveLength(0);
    expect(comments).toHaveLength(0);
  });
});
