import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedSystemCategories } from '../../src/payment/seed-system-categories';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 6.7 — GET /payments/:id + PATCH /payments/:id integration tests.
 *
 * Covers visibility (404 when not visible), creator-only mutation (403),
 * direction/category compatibility, date/amount sanity, empty-body no-op,
 * empty-string note → NULL, and best-effort PAYMENT_UPDATED audit log.
 */
describe('GET + PATCH /payments/:id (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let carol: Awaited<ReturnType<typeof registerUser>>;
  let groupId: string;
  let outCategoryId: string;
  let inCategoryId: string;

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

  const getOne = async (token: string, id: string) => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/payments/${id}`)
      .set('Authorization', `Bearer ${token}`);
    return { status: res.status, body: res.body };
  };

  const patchOne = async (token: string, id: string, body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/payments/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    return { status: res.status, body: res.body };
  };

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    alice = await registerUser(app, `edit-a-${suffix}@test.local`);
    bob = await registerUser(app, `edit-b-${suffix}@test.local`);
    carol = await registerUser(app, `edit-c-${suffix}@test.local`);

    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'Edit Fam', type: 'family' })
      .expect(201);
    groupId = groupRes.body.id;
    await prisma.groupMembership.create({
      data: { groupId, userId: carol.user.id, role: 'member' },
    });

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
    await prisma.auditLog.deleteMany({ where: { entity: 'Payment' } });
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

  // 1. GET :id as creator → 200
  it('1. creator fetches own personal payment → 200 with matching body', async () => {
    const created = await createPayment(alice.accessToken, basePayload({ note: 'dinner' }));
    const { status, body } = await getOne(alice.accessToken, created.id);
    expect(status).toBe(200);
    expect(body.id).toBe(created.id);
    expect(body.note).toBe('dinner');
    expect(body.starredByMe).toBe(false);
  });

  // 2. GET :id as a different user with no visibility → 404
  it('2. non-visible user → 404 PAYMENT_NOT_FOUND', async () => {
    const created = await createPayment(alice.accessToken, basePayload());
    const { status, body } = await getOne(bob.accessToken, created.id);
    expect(status).toBe(404);
    expect(body.errorCode).toBe('PAYMENT_NOT_FOUND');
  });

  // 3. GET :id as group member → 200
  it('3. group member fetches a group-attributed payment → 200', async () => {
    const created = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );
    const { status, body } = await getOne(carol.accessToken, created.id);
    expect(status).toBe(200);
    expect(body.id).toBe(created.id);
  });

  // 4. PATCH note as creator
  it('4. creator PATCH {note} → 200 and DB reflects the change', async () => {
    const created = await createPayment(alice.accessToken, basePayload({ note: 'before' }));
    const { status, body } = await patchOne(alice.accessToken, created.id, { note: 'updated' });
    expect(status).toBe(200);
    expect(body.note).toBe('updated');
    const row = await prisma.payment.findUnique({ where: { id: created.id } });
    expect(row!.note).toBe('updated');
  });

  // 5. PATCH as non-creator group member → 403
  it('5. non-creator member PATCH → 403 PAYMENT_NOT_OWNER', async () => {
    const created = await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );
    const { status, body } = await patchOne(carol.accessToken, created.id, { note: 'hax' });
    expect(status).toBe(403);
    expect(body.errorCode).toBe('PAYMENT_NOT_OWNER');
  });

  // 6. PATCH as non-member (no visibility) → 404
  it('6. non-member PATCH → 404 PAYMENT_NOT_FOUND (404 masks 403)', async () => {
    const created = await createPayment(alice.accessToken, basePayload());
    const { status, body } = await patchOne(bob.accessToken, created.id, { note: 'hax' });
    expect(status).toBe(404);
    expect(body.errorCode).toBe('PAYMENT_NOT_FOUND');
  });

  // 7. PATCH amount + date
  it('7. PATCH {amountCents, occurredAt} → 200 with both updated', async () => {
    const created = await createPayment(alice.accessToken, basePayload());
    const { status, body } = await patchOne(alice.accessToken, created.id, {
      amountCents: 9999,
      occurredAt: '2026-05-01',
    });
    expect(status).toBe(200);
    expect(body.amountCents).toBe(9999);
    expect(body.occurredAt.slice(0, 10)).toBe('2026-05-01');
  });

  // 8. Direction mismatch with current OUT category
  it('8. PATCH {direction: "IN"} on OUT category → 400 PAYMENT_CATEGORY_DIRECTION_MISMATCH', async () => {
    const created = await createPayment(alice.accessToken, basePayload());
    const { status, body } = await patchOne(alice.accessToken, created.id, { direction: 'IN' });
    expect(status).toBe(400);
    expect(body.errorCode).toBe('PAYMENT_CATEGORY_DIRECTION_MISMATCH');
  });

  // 9. Direction + category together
  it('9. PATCH {direction: "IN", categoryId: <IN>} → 200 with both updated', async () => {
    const created = await createPayment(alice.accessToken, basePayload());
    const { status, body } = await patchOne(alice.accessToken, created.id, {
      direction: 'IN',
      categoryId: inCategoryId,
    });
    expect(status).toBe(200);
    expect(body.direction).toBe('IN');
    expect(body.category.id).toBe(inCategoryId);
  });

  // 10. Future date > 1 day
  it('10. PATCH {occurredAt: 10d ahead} → 400 PAYMENT_INVALID_DATE', async () => {
    const created = await createPayment(alice.accessToken, basePayload());
    const far = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const { status, body } = await patchOne(alice.accessToken, created.id, { occurredAt: far });
    expect(status).toBe(400);
    expect(body.errorCode).toBe('PAYMENT_INVALID_DATE');
  });

  // 11. Empty body → no-op, no audit
  it('11. PATCH {} → 200, no PAYMENT_UPDATED audit row written', async () => {
    const created = await createPayment(alice.accessToken, basePayload());
    const before = await prisma.auditLog.findMany({
      where: { action: 'PAYMENT_UPDATED', entityId: created.id },
    });
    const { status } = await patchOne(alice.accessToken, created.id, {});
    expect(status).toBe(200);
    const after = await prisma.auditLog.findMany({
      where: { action: 'PAYMENT_UPDATED', entityId: created.id },
    });
    expect(after.length).toBe(before.length);
  });

  // 12. Empty string note → null in DB
  it('12. PATCH {note: ""} → 200, DB column is NULL', async () => {
    const created = await createPayment(alice.accessToken, basePayload({ note: 'before' }));
    const { status } = await patchOne(alice.accessToken, created.id, { note: '' });
    expect(status).toBe(200);
    const row = await prisma.payment.findUnique({ where: { id: created.id } });
    expect(row!.note).toBeNull();
  });

  // 13. Audit row has correct details.changed
  it('13. audit row PAYMENT_UPDATED carries details.changed with the mutated keys', async () => {
    const created = await createPayment(alice.accessToken, basePayload());
    await patchOne(alice.accessToken, created.id, { amountCents: 4242, note: 'x' });
    // Small delay so fire-and-forget audit lands.
    await new Promise((res) => setTimeout(res, 100));
    const rows = await prisma.auditLog.findMany({
      where: { action: 'PAYMENT_UPDATED', entityId: created.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const details = rows[0].details as { changed: string[] };
    expect(details.changed.sort()).toEqual(['amountCents', 'note']);
  });
});
