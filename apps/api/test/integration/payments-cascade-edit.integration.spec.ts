import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedSystemCategories } from '../../src/payment/seed-system-categories';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 6 · Iteration 6.18.1.5 — PATCH /payments/:id?propagate=... cascade edit.
 *
 * Full HTTP round-trip with a real RECURRING parent + children and a group the
 * editor is NOT a member of. Asserts DB state + response counts for the
 * scope-guard skip behaviour and the three propagation modes.
 */
describe('PATCH /payments/:id (cascade edit, integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let outCategoryId: string;
  let altOutCategoryId: string;
  let bobGroupId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    alice = await registerUser(app, `casc-a-${suffix}@test.local`);
    bob = await registerUser(app, `casc-b-${suffix}@test.local`);

    // Bob owns a group Alice is NOT a member of — used for the out-of-scope child.
    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({ name: 'Bob Fam', type: 'family' })
      .expect(201);
    bobGroupId = groupRes.body.id;

    const outCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    });
    const altOut = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: { not: 'groceries' } },
    });
    outCategoryId = outCat!.id;
    altOutCategoryId = altOut!.id;
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

  /**
   * Seed a RECURRING parent (personal Alice) plus children. Each child gets a
   * personal-Alice attribution; the child whose index is in `outOfScopeIdx`
   * also gets an attribution to Bob's group (which Alice can't control).
   * `pastIdx` children are placed in the past (occurredAt < now).
   */
  const seedTree = async (opts: {
    childCount: number;
    outOfScopeIdx?: number[];
    pastIdx?: number[];
  }): Promise<{ parentId: string; childIds: string[] }> => {
    const now = Date.now();
    const parent = await prisma.payment.create({
      data: {
        direction: 'OUT',
        type: 'RECURRING',
        amountCents: 1500,
        currency: 'USD',
        occurredAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
        status: 'POSTED',
        categoryId: outCategoryId,
        createdById: alice.user.id,
        attributions: { create: [{ scopeType: 'personal', userId: alice.user.id }] },
      },
    });
    const outOfScope = new Set(opts.outOfScopeIdx ?? []);
    const past = new Set(opts.pastIdx ?? []);
    const childIds: string[] = [];
    for (let i = 0; i < opts.childCount; i++) {
      const occurredAt = past.has(i)
        ? new Date(now - (10 + i) * 24 * 60 * 60 * 1000)
        : new Date(now + (10 + i) * 24 * 60 * 60 * 1000);
      const attributions: Array<{
        scopeType: string;
        userId?: string | null;
        groupId?: string | null;
      }> = [{ scopeType: 'personal', userId: alice.user.id }];
      if (outOfScope.has(i)) {
        attributions.push({ scopeType: 'group', groupId: bobGroupId });
      }
      const child = await prisma.payment.create({
        data: {
          direction: 'OUT',
          type: 'RECURRING',
          amountCents: 1500,
          currency: 'USD',
          occurredAt,
          status: 'POSTED',
          categoryId: outCategoryId,
          createdById: alice.user.id,
          parentPaymentId: parent.id,
          attributions: { create: attributions },
        },
      });
      childIds.push(child.id);
    }
    return { parentId: parent.id, childIds };
  };

  const patch = async (
    token: string,
    id: string,
    propagate: 'self' | 'future' | 'all',
    body: Record<string, unknown>,
  ) => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/payments/${id}?propagate=${propagate}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    return { status: res.status, body: res.body };
  };

  const amountOf = async (id: string): Promise<number> => {
    const row = await prisma.payment.findUnique({ where: { id }, select: { amountCents: true } });
    return row!.amountCents;
  };

  it('propagate=all updates the parent + every controllable child; out-of-scope-group child is skipped', async () => {
    // children: [0]=in-scope, [1]=out-of-scope (Bob group), [2]=in-scope
    const { parentId, childIds } = await seedTree({ childCount: 3, outOfScopeIdx: [1] });

    const { status, body } = await patch(alice.accessToken, parentId, 'all', { amountCents: 9999 });

    expect(status).toBe(200);
    expect(body.payment.id).toBe(parentId);
    expect(body.payment.amountCents).toBe(9999);
    expect(body.affectedChildrenCount).toBe(2);
    expect(body.skippedChildrenCount).toBe(1);

    expect(await amountOf(parentId)).toBe(9999);
    expect(await amountOf(childIds[0])).toBe(9999);
    expect(await amountOf(childIds[2])).toBe(9999);
    // The out-of-scope child is left entirely untouched.
    expect(await amountOf(childIds[1])).toBe(1500);
  });

  it('propagate=future updates only children with occurredAt >= now', async () => {
    // children: [0]=past, [1]=future, [2]=future
    const { parentId, childIds } = await seedTree({ childCount: 3, pastIdx: [0] });

    const { status, body } = await patch(alice.accessToken, parentId, 'future', {
      amountCents: 7777,
    });

    expect(status).toBe(200);
    expect(body.affectedChildrenCount).toBe(2);
    expect(body.skippedChildrenCount).toBe(0);

    expect(await amountOf(parentId)).toBe(7777);
    expect(await amountOf(childIds[0])).toBe(1500); // past child untouched
    expect(await amountOf(childIds[1])).toBe(7777);
    expect(await amountOf(childIds[2])).toBe(7777);
  });

  it('propagate=self updates only the parent (children untouched)', async () => {
    const { parentId, childIds } = await seedTree({ childCount: 2 });

    const { status, body } = await patch(alice.accessToken, parentId, 'self', {
      amountCents: 4242,
    });

    expect(status).toBe(200);
    expect(body.payment.id).toBe(parentId);
    expect(body.payment.amountCents).toBe(4242);
    expect(body.affectedChildrenCount).toBe(0);
    expect(body.skippedChildrenCount).toBe(0);

    expect(await amountOf(parentId)).toBe(4242);
    expect(await amountOf(childIds[0])).toBe(1500);
    expect(await amountOf(childIds[1])).toBe(1500);
  });

  it('propagate=all cascades a categoryId change to controllable children', async () => {
    const { parentId, childIds } = await seedTree({ childCount: 2 });

    const { status, body } = await patch(alice.accessToken, parentId, 'all', {
      categoryId: altOutCategoryId,
    });

    expect(status).toBe(200);
    expect(body.affectedChildrenCount).toBe(2);

    const rows = await prisma.payment.findMany({
      where: { id: { in: [parentId, ...childIds] } },
      select: { id: true, categoryId: true },
    });
    for (const row of rows) {
      expect(row.categoryId).toBe(altOutCategoryId);
    }
  });

  it('rejects an invalid propagate value with 400', async () => {
    const { parentId } = await seedTree({ childCount: 1 });
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/payments/${parentId}?propagate=everything`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ amountCents: 100 });
    expect(res.status).toBe(400);
  });
});
