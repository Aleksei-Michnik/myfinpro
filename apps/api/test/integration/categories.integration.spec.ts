import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedSystemCategories } from '../../src/payment/seed-system-categories';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 6.4 — Categories API integration tests.
 *
 * Uses the shared AppModule + env DB (same pattern as auth.integration.spec.ts).
 * Three users (admin / member / stranger) are registered once in beforeAll
 * to avoid tripping the 5/min /auth/register rate limit.
 */
describe('Categories API (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let admin: Awaited<ReturnType<typeof registerUser>>;
  let member: Awaited<ReturnType<typeof registerUser>>;
  let stranger: Awaited<ReturnType<typeof registerUser>>;
  let groupId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    // Bootstrap skips seeding under NODE_ENV=test — ensure defaults exist for these tests.
    await seedSystemCategories(prisma);

    admin = await registerUser(app, `cat-admin-${suffix}@test.local`);
    member = await registerUser(app, `cat-member-${suffix}@test.local`);
    stranger = await registerUser(app, `cat-stranger-${suffix}@test.local`);

    // Admin creates a group; member joins via invite.
    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Cat Integration Family', type: 'family' })
      .expect(201);
    groupId = groupRes.body.id;

    const invite = await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/invites`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/groups/invite/${invite.body.token}/accept`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // Remove user- and group-owned categories created during tests so cases stay isolated.
    await prisma.payment.deleteMany({
      where: { createdById: { in: [admin.user.id, member.user.id, stranger.user.id] } },
    });
    await prisma.category.deleteMany({
      where: {
        OR: [
          { ownerType: 'user', ownerId: { in: [admin.user.id, member.user.id, stranger.user.id] } },
          { ownerType: 'group', ownerId: groupId },
        ],
      },
    });
  });

  describe('GET /categories', () => {
    it('401 without a bearer token', async () => {
      await request(app.getHttpServer()).get('/api/v1/categories').expect(401);
    });

    it('returns system categories to any authenticated user (scope=system)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories?scope=system')
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .expect(200);

      const systemRows = (res.body as Array<{ ownerType: string }>).filter(
        (c) => c.ownerType === 'system',
      );
      expect(systemRows.length).toBeGreaterThan(0);
      expect(res.body.every((c: { ownerType: string }) => c.ownerType === 'system')).toBe(true);
    });

    it("does not expose another user's personal categories", async () => {
      // Admin creates a personal category.
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Secret A', direction: 'OUT', scope: 'personal' })
        .expect(201);

      // Stranger lists personal scope — should not see it.
      const res = await request(app.getHttpServer())
        .get('/api/v1/categories?scope=personal')
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .expect(200);

      const names = (res.body as Array<{ name: string }>).map((c) => c.name);
      expect(names).not.toContain('Secret A');
    });

    it('400 for an unknown scope string', async () => {
      // Invalid scope is caught by the DTO regex → 400 from ValidationPipe.
      await request(app.getHttpServer())
        .get('/api/v1/categories?scope=bogus')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(400);
    });
  });

  describe('POST /categories', () => {
    it('creates a personal category with an auto-generated slug', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Coffee Shops', direction: 'OUT', scope: 'personal' })
        .expect(201);

      expect(res.body).toEqual(
        expect.objectContaining({
          name: 'Coffee Shops',
          slug: 'coffee_shops',
          direction: 'OUT',
          ownerType: 'user',
          ownerId: admin.user.id,
          isSystem: false,
        }),
      );
    });

    it('admin creates a group category; member sees it, stranger 403; non-admin 403', async () => {
      const ok = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Team Coffee', direction: 'OUT', scope: 'group', groupId })
        .expect(201);
      expect(ok.body.ownerType).toBe('group');
      expect(ok.body.ownerId).toBe(groupId);

      // Non-admin member cannot create group categories.
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ name: 'Team Snacks', direction: 'OUT', scope: 'group', groupId })
        .expect(403);

      // Stranger is not a member at all.
      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ name: 'Team Other', direction: 'OUT', scope: 'group', groupId })
        .expect(403);

      // Member sees the group category via scope=group:<id>.
      const list = await request(app.getHttpServer())
        .get(`/api/v1/categories?scope=group:${groupId}`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .expect(200);
      const names = (list.body as Array<{ name: string }>).map((c) => c.name);
      expect(names).toContain('Team Coffee');

      // Stranger cannot even list with that scope.
      await request(app.getHttpServer())
        .get(`/api/v1/categories?scope=group:${groupId}`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .expect(403);
    });
  });

  describe('PATCH /categories/:id', () => {
    it('owner can rename; non-owner 403; system 403', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Rent', direction: 'OUT', scope: 'personal' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${created.body.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Housing' })
        .expect(200);

      // Stranger cannot modify admin's category.
      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${created.body.id}`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ name: 'Pwned' })
        .expect(403);

      // System categories immutable.
      const sys = await prisma.category.findFirst({ where: { ownerType: 'system' } });
      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${sys!.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Nope' })
        .expect(403);
    });
  });

  describe('DELETE /categories/:id with reassignment', () => {
    it('reassigns attached payments to replacement and deletes the source', async () => {
      const source = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Old Bucket', direction: 'OUT', scope: 'personal' })
        .expect(201);

      const target = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'New Bucket', direction: 'OUT', scope: 'personal' })
        .expect(201);

      // Seed a Payment pointing at source directly via Prisma (no PaymentController yet).
      const payment = await prisma.payment.create({
        data: {
          direction: 'OUT',
          type: 'ONE_TIME',
          amountCents: 1234,
          currency: 'USD',
          occurredAt: new Date(),
          status: 'POSTED',
          categoryId: source.body.id,
          createdById: admin.user.id,
          attributions: {
            create: { scopeType: 'personal', userId: admin.user.id },
          },
        },
      });

      // In-use without replacement → 409.
      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${source.body.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(409);

      // With valid replacement → 200 + reassigned: 1.
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/categories/${source.body.id}?replaceWithCategoryId=${target.body.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(res.body).toEqual({ deleted: true, reassigned: 1 });

      // Payment now points at target.
      const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
      expect(updated?.categoryId).toBe(target.body.id);

      // Source gone.
      const gone = await prisma.category.findUnique({ where: { id: source.body.id } });
      expect(gone).toBeNull();
    });
  });
});
