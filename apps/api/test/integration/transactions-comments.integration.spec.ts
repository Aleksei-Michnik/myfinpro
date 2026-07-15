import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 6.10 — Transaction comments CRUD + soft-delete integration tests.
 */
describe('Transaction comments API (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let carol: Awaited<ReturnType<typeof registerUser>>;
  let groupId: string;
  let outCategoryId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const createTransaction = async (
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string }> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    return res.body;
  };

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    alice = await registerUser(app, `cmt-a-${suffix}@test.local`);
    bob = await registerUser(app, `cmt-b-${suffix}@test.local`);
    carol = await registerUser(app, `cmt-c-${suffix}@test.local`);

    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: 'Cmt Fam', type: 'family' })
      .expect(201);
    groupId = groupRes.body.id;
    await prisma.groupMembership.create({
      data: { groupId, userId: bob.user.id, role: 'member' },
    });
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
    await prisma.transactionComment.deleteMany({});
    await prisma.transactionAttribution.deleteMany({});
    await prisma.transaction.deleteMany({
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

  // ── 1 ──
  it('1. author creates a comment on own personal transaction → 201, body matches', async () => {
    const { id: pid } = await createTransaction(alice.accessToken, basePayload());
    const res = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'first' })
      .expect(201);
    expect(res.body.content).toBe('first');
    expect(res.body.transactionId).toBe(pid);
    expect(res.body.isMine).toBe(true);
    expect(res.body.author.id).toBe(alice.user.id);
  });

  // ── 2 ──
  it('2. GET list returns the new comment oldest-first', async () => {
    const { id: pid } = await createTransaction(alice.accessToken, basePayload());
    await request(app.getHttpServer())
      .post(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'one' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].content).toBe('one');
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
  });

  // ── 3 ──
  it('3. other user without visibility GET list → 404', async () => {
    const { id: pid } = await createTransaction(alice.accessToken, basePayload());
    const r = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${bob.accessToken}`);
    expect(r.status).toBe(404);
    expect(r.body.errorCode).toBe('TRANSACTION_NOT_FOUND');
  });

  // ── 4 ──
  it('4. other user without visibility POST → 404', async () => {
    const { id: pid } = await createTransaction(alice.accessToken, basePayload());
    const r = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({ content: 'x' });
    expect(r.status).toBe(404);
  });

  // ── 5 ──
  it('5. group transaction: member B comments, member C lists and sees both', async () => {
    const { id: pid } = await createTransaction(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'A here' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({ content: 'B here' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${carol.accessToken}`)
      .expect(200);
    expect(res.body.data.map((c: { content: string }) => c.content)).toEqual(['A here', 'B here']);
    // Carol is neither author → isMine=false for all.
    expect(res.body.data.every((c: { isMine: boolean }) => c.isMine === false)).toBe(true);
  });

  // ── 6 ──
  it('6. author edits own comment → 200, updatedAt > createdAt', async () => {
    const { id: pid } = await createTransaction(alice.accessToken, basePayload());
    const c = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'v1' })
      .expect(201);

    // Small wait so updatedAt clearly moves forward (MySQL datetime resolution is 1s on default cols).
    await new Promise((r) => setTimeout(r, 1100));

    const upd = await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${pid}/comments/${c.body.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'v2' })
      .expect(200);
    expect(upd.body.content).toBe('v2');
    expect(new Date(upd.body.updatedAt).getTime()).toBeGreaterThan(
      new Date(c.body.createdAt).getTime(),
    );
  });

  // ── 7 ──
  it("7. member B tries to edit A's comment → 403 TRANSACTION_COMMENT_NOT_AUTHOR", async () => {
    const { id: pid } = await createTransaction(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );
    const c = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'mine' })
      .expect(201);
    const r = await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${pid}/comments/${c.body.id}`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({ content: 'hax' });
    expect(r.status).toBe(403);
    expect(r.body.errorCode).toBe('TRANSACTION_COMMENT_NOT_AUTHOR');
  });

  // ── 8 ──
  it('8. author soft-deletes own comment → 204; list excludes it; DB row persists with empty content', async () => {
    const { id: pid } = await createTransaction(alice.accessToken, basePayload());
    const c = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'to-kill' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${pid}/comments/${c.body.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(list.body.data).toHaveLength(0);

    const row = await prisma.transactionComment.findUnique({ where: { id: c.body.id } });
    expect(row).not.toBeNull();
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.content).toBe('');
  });

  // ── 9 ──
  it('9. editing an already-soft-deleted comment → 410 TRANSACTION_COMMENT_DELETED', async () => {
    const { id: pid } = await createTransaction(alice.accessToken, basePayload());
    const c = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'x' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${pid}/comments/${c.body.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(204);
    const r = await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${pid}/comments/${c.body.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'zombie' });
    expect(r.status).toBe(410);
    expect(r.body.errorCode).toBe('TRANSACTION_COMMENT_DELETED');
  });

  // ── 10 ──
  it('10. PATCH a non-existent comment under a visible transaction → 404', async () => {
    const { id: pid } = await createTransaction(alice.accessToken, basePayload());
    const r = await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${pid}/comments/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'x' });
    expect(r.status).toBe(404);
    expect(r.body.errorCode).toBe('TRANSACTION_COMMENT_NOT_FOUND');
  });

  // ── 11 ──
  it('11. cursor pagination: 5 comments / limit=2 → 3 pages', async () => {
    const { id: pid } = await createTransaction(alice.accessToken, basePayload());
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post(`/api/v1/transactions/${pid}/comments`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ content: `m${i}` })
        .expect(201);
      // Ensure ordering on MySQL datetime resolution.
      await new Promise((r) => setTimeout(r, 1100));
    }

    const p1 = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${pid}/comments?limit=2`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(p1.body.data.map((c: { content: string }) => c.content)).toEqual(['m0', 'm1']);
    expect(p1.body.hasMore).toBe(true);
    expect(p1.body.nextCursor).toBeTruthy();

    const p2 = await request(app.getHttpServer())
      .get(
        `/api/v1/transactions/${pid}/comments?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(p2.body.data.map((c: { content: string }) => c.content)).toEqual(['m2', 'm3']);
    expect(p2.body.hasMore).toBe(true);

    const p3 = await request(app.getHttpServer())
      .get(
        `/api/v1/transactions/${pid}/comments?limit=2&cursor=${encodeURIComponent(p2.body.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(p3.body.data.map((c: { content: string }) => c.content)).toEqual(['m4']);
    expect(p3.body.hasMore).toBe(false);
    expect(p3.body.nextCursor).toBeNull();
  }, 30_000);

  // ── 12 ──
  it('12. invalid cursor → 400 TRANSACTION_COMMENT_INVALID_CURSOR', async () => {
    const { id: pid } = await createTransaction(alice.accessToken, basePayload());
    const r = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${pid}/comments?cursor=not-base64`)
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(r.status).toBe(400);
    expect(r.body.errorCode).toBe('TRANSACTION_COMMENT_INVALID_CURSOR');
  });

  // ── 13 ──
  it('13. cascade: DELETE ?scope=all removes all comments (including soft-deleted)', async () => {
    const { id: pid } = await createTransaction(
      alice.accessToken,
      basePayload({ attributions: [{ scope: 'group', groupId }] }),
    );
    const c1 = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'live' })
      .expect(201);
    const c2 = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({ content: 'to-soft-delete' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${pid}/comments/${c2.body.id}`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(204);

    const beforeRows = await prisma.transactionComment.findMany({ where: { transactionId: pid } });
    expect(beforeRows).toHaveLength(2);

    // Hard-delete the transaction — alice drops the only group attribution via scope=all.
    await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${pid}?scope=all`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);

    const afterRows = await prisma.transactionComment.findMany({ where: { transactionId: pid } });
    expect(afterRows).toHaveLength(0);
    // unused var silencer
    expect(c1.body.id).toBeTruthy();
  });

  // ── 14 ──
  it('14. audit trail: create + update + delete writes 3 rows with same entityId', async () => {
    const { id: pid } = await createTransaction(alice.accessToken, basePayload());
    const c = await request(app.getHttpServer())
      .post(`/api/v1/transactions/${pid}/comments`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'x' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${pid}/comments/${c.body.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ content: 'y' })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/transactions/${pid}/comments/${c.body.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(204);

    await new Promise((r) => setTimeout(r, 150));

    const audits = await prisma.auditLog.findMany({
      where: {
        entity: 'Transaction',
        entityId: pid,
        action: {
          in: [
            'TRANSACTION_COMMENT_CREATED',
            'TRANSACTION_COMMENT_UPDATED',
            'TRANSACTION_COMMENT_DELETED',
          ],
        },
        userId: alice.user.id,
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.action)).toEqual([
      'TRANSACTION_COMMENT_CREATED',
      'TRANSACTION_COMMENT_UPDATED',
      'TRANSACTION_COMMENT_DELETED',
    ]);
  });
});
