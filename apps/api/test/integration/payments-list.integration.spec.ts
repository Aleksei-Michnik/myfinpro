import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedSystemCategories } from '../../src/payment/seed-system-categories';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 6.6 — GET /payments integration tests.
 *
 * Covers visibility union (personal + member-groups), every filter, sort,
 * cursor pagination, scope narrowing (and 403 on non-member group).
 */
describe('GET /payments (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let carol: Awaited<ReturnType<typeof registerUser>>;
  let groupId: string;
  let outCategoryId: string;
  let inCategoryId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  /** Create a payment directly via POST /payments as the given user. */
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

  const listPayments = async (
    token: string,
    query: Record<string, string | number> = {},
  ): Promise<{
    status: number;
    body: {
      data: Array<Record<string, unknown>>;
      nextCursor: string | null;
      hasMore: boolean;
      errorCode?: string;
    };
  }> => {
    const qs = new URLSearchParams(
      Object.entries(query).map(([k, v]) => [k, String(v)]),
    ).toString();
    const res = await request(app.getHttpServer())
      .get(`/api/v1/payments${qs ? `?${qs}` : ''}`)
      .set('Authorization', `Bearer ${token}`);
    return { status: res.status, body: res.body };
  };

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    alice = await registerUser(app, `list-a-${suffix}@test.local`);
    bob = await registerUser(app, `list-b-${suffix}@test.local`);
    carol = await registerUser(app, `list-c-${suffix}@test.local`);

    // Alice creates a group; Carol joins directly via Prisma (invite flow
    // is covered by Phase 5 tests — we just need membership here).
    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'List Fam', type: 'family' })
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

  // ── 1. Baseline personal visibility ──

  it('1. returns all personal payments, newest first, with expected defaults', async () => {
    await createPayment(
      alice.accessToken,
      basePayload({ amountCents: 100, occurredAt: '2026-04-10' }),
    );
    await createPayment(
      alice.accessToken,
      basePayload({ amountCents: 300, occurredAt: '2026-04-20' }),
    );
    await createPayment(
      alice.accessToken,
      basePayload({ amountCents: 200, occurredAt: '2026-04-15' }),
    );

    const { status, body } = await listPayments(alice.accessToken);
    expect(status).toBe(200);
    expect(body.data).toHaveLength(3);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();

    const dates = body.data.map((r) => r.occurredAt as string);
    expect(dates).toEqual([...dates].sort((a, b) => (a < b ? 1 : -1)));

    expect(body.data[0]).toEqual(
      expect.objectContaining({
        starredByMe: false,
        commentCount: 0,
        hasDocuments: false,
      }),
    );
  });

  it('2. user B sees none of user A personal payments', async () => {
    await createPayment(alice.accessToken, basePayload());
    const { body } = await listPayments(bob.accessToken);
    expect(body.data).toHaveLength(0);
  });

  // ── 3. Group visibility ──

  it('3. group member sees group payments; non-member does not', async () => {
    await createPayment(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );

    const forCarol = await listPayments(carol.accessToken);
    expect(forCarol.body.data).toHaveLength(1);

    const forBob = await listPayments(bob.accessToken);
    expect(forBob.body.data).toHaveLength(0);
  });

  // ── 4. scope narrowing ──

  it('4. scope=personal returns only personal rows', async () => {
    await createPayment(alice.accessToken, basePayload({ amountCents: 100 }));
    await createPayment(
      alice.accessToken,
      basePayload({ amountCents: 200, attributions: [{ scope: 'group', groupId }] }),
    );

    const { body } = await listPayments(alice.accessToken, { scope: 'personal' });
    expect(body.data).toHaveLength(1);
    expect(body.data[0].amountCents).toBe(100);
  });

  it('5. scope=group:<id> as a member returns only group rows', async () => {
    await createPayment(alice.accessToken, basePayload({ amountCents: 100 }));
    await createPayment(
      alice.accessToken,
      basePayload({ amountCents: 200, attributions: [{ scope: 'group', groupId }] }),
    );

    const { body } = await listPayments(alice.accessToken, { scope: `group:${groupId}` });
    expect(body.data).toHaveLength(1);
    expect(body.data[0].amountCents).toBe(200);
  });

  it('6. scope=group:<id> as non-member → 403 PAYMENT_SCOPE_NOT_ACCESSIBLE', async () => {
    const { status, body } = await listPayments(bob.accessToken, { scope: `group:${groupId}` });
    expect(status).toBe(403);
    expect(body.errorCode).toBe('PAYMENT_SCOPE_NOT_ACCESSIBLE');
  });

  // ── 7-11. Filters ──

  it('7. direction=IN filter', async () => {
    await createPayment(alice.accessToken, basePayload({ direction: 'OUT' }));
    await createPayment(
      alice.accessToken,
      basePayload({ direction: 'IN', categoryId: inCategoryId }),
    );

    const { body } = await listPayments(alice.accessToken, { direction: 'IN' });
    expect(body.data).toHaveLength(1);
    expect(body.data[0].direction).toBe('IN');
  });

  it('8. from/to date range filter', async () => {
    await createPayment(alice.accessToken, basePayload({ occurredAt: '2026-02-15' }));
    await createPayment(alice.accessToken, basePayload({ occurredAt: '2026-03-15' }));
    await createPayment(alice.accessToken, basePayload({ occurredAt: '2026-04-15' }));

    const { body } = await listPayments(alice.accessToken, {
      from: '2026-03-01T00:00:00Z',
      to: '2026-04-01T00:00:00Z',
    });
    expect(body.data).toHaveLength(1);
    expect((body.data[0].occurredAt as string).slice(0, 7)).toBe('2026-03');
  });

  it('9. categoryId filter', async () => {
    await createPayment(alice.accessToken, basePayload({ categoryId: outCategoryId }));
    await createPayment(
      alice.accessToken,
      basePayload({ direction: 'IN', categoryId: inCategoryId }),
    );

    const { body } = await listPayments(alice.accessToken, { categoryId: outCategoryId });
    expect(body.data).toHaveLength(1);
    expect((body.data[0].category as { id: string }).id).toBe(outCategoryId);
  });

  it('10. type=ONE_TIME filter (only type currently supported)', async () => {
    await createPayment(alice.accessToken, basePayload());
    const { body } = await listPayments(alice.accessToken, { type: 'ONE_TIME' });
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe('ONE_TIME');
  });

  it('11. search substring-matches notes', async () => {
    await createPayment(alice.accessToken, basePayload({ note: 'Lunch with Eve' }));
    await createPayment(alice.accessToken, basePayload({ note: 'Groceries run' }));

    const { body } = await listPayments(alice.accessToken, { search: 'lunch' });
    expect(body.data).toHaveLength(1);
    expect(body.data[0].note).toBe('Lunch with Eve');
  });

  // ── 12. Cursor pagination round-trip ──

  it('12. cursor pagination: 5 rows / limit=2 walks through three pages', async () => {
    for (let i = 0; i < 5; i++) {
      const d = `2026-04-${String(10 + i).padStart(2, '0')}`;
      await createPayment(alice.accessToken, basePayload({ amountCents: 100 + i, occurredAt: d }));
    }

    // Page 1 — newest 2.
    const p1 = await listPayments(alice.accessToken, { limit: 2 });
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.hasMore).toBe(true);
    expect(p1.body.nextCursor).not.toBeNull();

    // Page 2.
    const p2 = await listPayments(alice.accessToken, { limit: 2, cursor: p1.body.nextCursor! });
    expect(p2.body.data).toHaveLength(2);
    expect(p2.body.hasMore).toBe(true);
    expect(p2.body.nextCursor).not.toBeNull();

    // Page 3 — last row.
    const p3 = await listPayments(alice.accessToken, { limit: 2, cursor: p2.body.nextCursor! });
    expect(p3.body.data).toHaveLength(1);
    expect(p3.body.hasMore).toBe(false);
    expect(p3.body.nextCursor).toBeNull();

    // No overlap between pages.
    const allIds = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((r) => r.id);
    expect(new Set(allIds).size).toBe(5);
  });

  // ── 13. Bad cursor ──

  it('13. invalid cursor → 400 PAYMENT_INVALID_CURSOR', async () => {
    const { status, body } = await listPayments(alice.accessToken, {
      cursor: 'definitely-not-base64url!',
    });
    expect(status).toBe(400);
    expect(body.errorCode).toBe('PAYMENT_INVALID_CURSOR');
  });

  // ── 14. sort=amount_desc ──

  it('14. sort=amount_desc returns rows ordered by amountCents descending', async () => {
    await createPayment(alice.accessToken, basePayload({ amountCents: 500 }));
    await createPayment(alice.accessToken, basePayload({ amountCents: 2000 }));
    await createPayment(alice.accessToken, basePayload({ amountCents: 900 }));

    const { body } = await listPayments(alice.accessToken, { sort: 'amount_desc' });
    expect(body.data.map((r) => r.amountCents)).toEqual([2000, 900, 500]);
  });

  // ── 15-19. parentPaymentId / withParent filters + /occurrences alias (6.18.1.3) ──

  /**
   * Synthesise a parent + N children directly via Prisma (avoids waiting on
   * the BullMQ scheduler in unit-style integration tests). The API tests in
   * `payment-occurrence.integration.spec.ts` cover the happy-path pipeline
   * end-to-end; here we only need the row shape.
   */
  const seedParentWithChildren = async (
    creatorId: string,
    childCount: number,
  ): Promise<{ parentId: string; childIds: string[] }> => {
    const parent = await prisma.payment.create({
      data: {
        direction: 'OUT',
        type: 'RECURRING',
        amountCents: 1500,
        currency: 'USD',
        occurredAt: new Date('2026-04-25T00:00:00Z'),
        status: 'POSTED',
        categoryId: outCategoryId,
        createdById: creatorId,
        attributions: { create: [{ scopeType: 'personal', userId: creatorId }] },
      },
    });
    const childIds: string[] = [];
    for (let i = 0; i < childCount; i++) {
      const child = await prisma.payment.create({
        data: {
          direction: 'OUT',
          type: 'RECURRING',
          amountCents: 1500,
          currency: 'USD',
          occurredAt: new Date(`2026-05-${String(1 + i).padStart(2, '0')}T00:00:00Z`),
          status: 'POSTED',
          categoryId: outCategoryId,
          createdById: creatorId,
          parentPaymentId: parent.id,
          attributions: { create: [{ scopeType: 'personal', userId: creatorId }] },
        },
      });
      childIds.push(child.id);
    }
    return { parentId: parent.id, childIds };
  };

  it('15. /payments/:id/occurrences returns children only (parent excluded)', async () => {
    const { parentId, childIds } = await seedParentWithChildren(alice.user.id, 3);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/payments/${parentId}/occurrences`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);

    const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids)).toEqual(new Set(childIds));
    expect(ids).not.toContain(parentId);
  });

  it('16. /payments?parentPaymentId=<id> returns the same set as the alias', async () => {
    const { parentId, childIds } = await seedParentWithChildren(alice.user.id, 2);

    const { body } = await listPayments(alice.accessToken, { parentPaymentId: parentId });
    const ids = body.data.map((r) => r.id as string);
    expect(new Set(ids)).toEqual(new Set(childIds));
  });

  it('17. /payments/:id/occurrences for a caller who cannot see the parent → 404 (no leak)', async () => {
    const { parentId } = await seedParentWithChildren(alice.user.id, 2);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/payments/${parentId}/occurrences`)
      .set('Authorization', `Bearer ${bob.accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('PAYMENT_NOT_FOUND');
  });

  it('18. withParent=true returns parents only; withParent=false returns occurrences only', async () => {
    // 1 parent + 2 children + 1 unrelated ONE_TIME owned by Alice.
    await seedParentWithChildren(alice.user.id, 2);
    await createPayment(alice.accessToken, basePayload({ amountCents: 999 }));

    const onlyParents = await listPayments(alice.accessToken, { withParent: 'true' });
    const parentTypes = onlyParents.body.data.map((r) => r.parentPaymentId);
    expect(parentTypes.every((p) => p === null)).toBe(true);
    expect(onlyParents.body.data).toHaveLength(2); // RECURRING parent + ONE_TIME

    const onlyChildren = await listPayments(alice.accessToken, { withParent: 'false' });
    expect(onlyChildren.body.data).toHaveLength(2);
    expect(onlyChildren.body.data.every((r) => r.parentPaymentId !== null)).toBe(true);
  });

  it('19. /payments/:id/occurrences for a one-time payment returns an empty list (200, not 404)', async () => {
    const created = await createPayment(alice.accessToken, basePayload());

    const res = await request(app.getHttpServer())
      .get(`/api/v1/payments/${created.id}/occurrences`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
  });
});
