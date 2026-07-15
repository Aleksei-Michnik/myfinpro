import * as crypto from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 10 · Iteration 10.2 — /budgets CRUD + archive integration tests.
 *
 * Bootstraps the real AppModule against the env DB (same pattern as
 * categories.integration.spec.ts) and exercises the endpoints end-to-end:
 * auth, the scope/role matrix (owner / group admin / group member /
 * outsider), category + period validation, archived-budget mutation
 * rejection, audit rows, and list filters.
 *
 * Users: `owner` (personal budgets + admin of the group), `member`
 * (group member, read-only on group budgets), `outsider` (no access).
 * List fixtures are seeded via Prisma directly so the suite stays well
 * under the 30/min mutation throttle per route.
 */
describe('Budgets API (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let owner: Awaited<ReturnType<typeof registerUser>>;
  let member: Awaited<ReturnType<typeof registerUser>>;
  let outsider: Awaited<ReturnType<typeof registerUser>>;
  let groupId: string;

  let systemOutCategoryId: string;
  let systemInCategoryId: string;
  let ownerPersonalCategoryId: string;
  let memberPersonalCategoryId: string;
  let groupCategoryId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    owner = await registerUser(app, `bud-owner-${suffix}@test.local`);
    member = await registerUser(app, `bud-member-${suffix}@test.local`);
    outsider = await registerUser(app, `bud-outsider-${suffix}@test.local`);

    // Deterministic currency defaults for the fallback tests.
    await prisma.user.update({
      where: { id: owner.user.id },
      data: { defaultCurrency: 'ILS' },
    });

    // Owner creates a group (becomes admin); member joins as plain member.
    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Budget Fam', type: 'family' })
      .expect(201);
    groupId = groupRes.body.id;
    await prisma.group.update({ where: { id: groupId }, data: { defaultCurrency: 'EUR' } });
    await prisma.groupMembership.create({
      data: { groupId, userId: member.user.id, role: 'member' },
    });

    const outCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT' },
    });
    const inCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'IN' },
    });
    systemOutCategoryId = outCat!.id;
    systemInCategoryId = inCat!.id;

    ownerPersonalCategoryId = (
      await prisma.category.create({
        data: {
          slug: `bud_owner_cat_${suffix}`,
          name: 'Owner personal OUT',
          direction: 'OUT',
          ownerType: 'user',
          ownerId: owner.user.id,
          isSystem: false,
        },
      })
    ).id;
    memberPersonalCategoryId = (
      await prisma.category.create({
        data: {
          slug: `bud_member_cat_${suffix}`,
          name: 'Member personal OUT',
          direction: 'OUT',
          ownerType: 'user',
          ownerId: member.user.id,
          isSystem: false,
        },
      })
    ).id;
    groupCategoryId = (
      await prisma.category.create({
        data: {
          slug: `bud_group_cat_${suffix}`,
          name: 'Group OUT',
          direction: 'OUT',
          ownerType: 'group',
          ownerId: groupId,
          isSystem: false,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    const userIds = [owner.user.id, member.user.id, outsider.user.id];
    await prisma.budget.deleteMany({ where: { createdById: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { entity: 'Budget', userId: { in: userIds } } });
  });

  const personalPayload = (over: Record<string, unknown> = {}) => ({
    name: 'Groceries',
    amountCents: 80000,
    currency: 'ILS',
    scopeType: 'personal',
    period: 'MONTHLY',
    ...over,
  });

  const groupPayload = (over: Record<string, unknown> = {}) => ({
    name: 'Team budget',
    amountCents: 50000,
    currency: 'EUR',
    scopeType: 'group',
    groupId,
    period: 'MONTHLY',
    ...over,
  });

  /** Seed a budget row directly (keeps the suite under the mutation throttle). */
  const seedBudget = (over: Record<string, unknown> = {}) =>
    prisma.budget.create({
      data: {
        name: 'Seeded',
        amountCents: 1000,
        currency: 'ILS',
        scopeType: 'personal',
        ownerId: owner.user.id,
        groupId: null,
        period: 'MONTHLY',
        createdById: owner.user.id,
        ...over,
      },
    });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // ── Personal owner CRUD ──

  it('owner creates / reads / edits / deletes a personal budget; audits each step', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set(auth(owner.accessToken))
      .send(personalPayload({ alertThresholdPct: 80 }))
      .expect(201);

    const id = createRes.body.id as string;
    expect(createRes.body).toMatchObject({
      name: 'Groceries',
      amountCents: 80000,
      currency: 'ILS',
      scopeType: 'personal',
      ownerId: owner.user.id,
      groupId: null,
      period: 'MONTHLY',
      startsAt: null,
      endsAt: null,
      alertThresholdPct: 80,
      alertOverspend: true,
      archivedAt: null,
      createdById: owner.user.id,
    });

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/budgets/${id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(getRes.body.id).toBe(id);

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/budgets/${id}`)
      .set(auth(owner.accessToken))
      .send({ name: 'Food', amountCents: 90000, alertThresholdPct: null })
      .expect(200);
    expect(patchRes.body).toMatchObject({
      name: 'Food',
      amountCents: 90000,
      alertThresholdPct: null,
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/budgets/${id}`)
      .set(auth(owner.accessToken))
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/budgets/${id}`)
      .set(auth(owner.accessToken))
      .expect(404);

    const audits = await prisma.auditLog.findMany({
      where: { entity: 'Budget', entityId: id },
    });
    expect(audits.map((a) => a.action).sort()).toEqual([
      'BUDGET_CREATED',
      'BUDGET_DELETED',
      'BUDGET_UPDATED',
    ]);
    expect(audits.every((a) => a.userId === owner.user.id)).toBe(true);
  });

  it("defaults currency to the owner's defaultCurrency when omitted", async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set(auth(owner.accessToken))
      .send(personalPayload({ currency: undefined }))
      .expect(201);
    expect(res.body.currency).toBe('ILS');
  });

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/api/v1/budgets').expect(401);
    await request(app.getHttpServer()).post('/api/v1/budgets').send(personalPayload()).expect(401);
  });

  // ── Outsider on a personal budget → 404, never a leak ──

  it('404s every outsider operation on a personal budget (BUDGET_NOT_FOUND)', async () => {
    const budget = await seedBudget();

    for (const [method, url] of [
      ['get', `/api/v1/budgets/${budget.id}`],
      ['patch', `/api/v1/budgets/${budget.id}`],
      ['delete', `/api/v1/budgets/${budget.id}`],
      ['post', `/api/v1/budgets/${budget.id}/archive`],
      ['post', `/api/v1/budgets/${budget.id}/unarchive`],
    ] as const) {
      const res = await request(app.getHttpServer())
        [method](url)
        .set(auth(outsider.accessToken))
        .send(method === 'patch' ? { name: 'Hijack' } : undefined)
        .expect(404);
      expect(res.body.errorCode).toBe('BUDGET_NOT_FOUND');
    }
  });

  it('404s a nonexistent budget id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/budgets/${crypto.randomUUID()}`)
      .set(auth(owner.accessToken))
      .expect(404);
    expect(res.body.errorCode).toBe('BUDGET_NOT_FOUND');
  });

  // ── Group scope matrix ──

  it('group admin creates a group budget; member can read it; outsider 404s', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set(auth(owner.accessToken))
      .send(groupPayload({ currency: undefined }))
      .expect(201);
    const id = createRes.body.id as string;
    expect(createRes.body).toMatchObject({
      scopeType: 'group',
      groupId,
      ownerId: null,
      currency: 'EUR', // group defaultCurrency fallback
    });

    const memberRes = await request(app.getHttpServer())
      .get(`/api/v1/budgets/${id}`)
      .set(auth(member.accessToken))
      .expect(200);
    expect(memberRes.body.id).toBe(id);

    const outsiderRes = await request(app.getHttpServer())
      .get(`/api/v1/budgets/${id}`)
      .set(auth(outsider.accessToken))
      .expect(404);
    expect(outsiderRes.body.errorCode).toBe('BUDGET_NOT_FOUND');
  });

  it('403s a group member (non-admin) on every mutation (BUDGET_FORBIDDEN)', async () => {
    const budget = await seedBudget({
      scopeType: 'group',
      ownerId: null,
      groupId,
      currency: 'EUR',
    });

    for (const [method, url] of [
      ['patch', `/api/v1/budgets/${budget.id}`],
      ['delete', `/api/v1/budgets/${budget.id}`],
      ['post', `/api/v1/budgets/${budget.id}/archive`],
      ['post', `/api/v1/budgets/${budget.id}/unarchive`],
    ] as const) {
      const res = await request(app.getHttpServer())
        [method](url)
        .set(auth(member.accessToken))
        .send(method === 'patch' ? { name: 'Nope' } : undefined)
        .expect(403);
      expect(res.body.errorCode).toBe('BUDGET_FORBIDDEN');
    }
  });

  it('403s a member creating a group budget; 404s a non-member (no group leak)', async () => {
    const memberRes = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set(auth(member.accessToken))
      .send(groupPayload())
      .expect(403);
    expect(memberRes.body.errorCode).toBe('BUDGET_FORBIDDEN');

    const outsiderRes = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set(auth(outsider.accessToken))
      .send(groupPayload())
      .expect(404);
    expect(outsiderRes.body.errorCode).toBe('BUDGET_INVALID_SCOPE');
  });

  it('group admin edits, archives, unarchives and deletes a group budget', async () => {
    const budget = await seedBudget({
      scopeType: 'group',
      ownerId: null,
      groupId,
      currency: 'EUR',
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/budgets/${budget.id}`)
      .set(auth(owner.accessToken))
      .send({ name: 'Renamed by admin' })
      .expect(200);

    const archived = await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budget.id}/archive`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(archived.body.archivedAt).not.toBeNull();

    const unarchived = await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budget.id}/unarchive`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(unarchived.body.archivedAt).toBeNull();

    await request(app.getHttpServer())
      .delete(`/api/v1/budgets/${budget.id}`)
      .set(auth(owner.accessToken))
      .expect(204);

    const audits = await prisma.auditLog.findMany({
      where: { entity: 'Budget', entityId: budget.id },
    });
    expect(audits.map((a) => a.action).sort()).toEqual([
      'BUDGET_ARCHIVED',
      'BUDGET_DELETED',
      'BUDGET_UNARCHIVED',
      'BUDGET_UPDATED',
    ]);
  });

  it('rejects malformed scope combinations (BUDGET_INVALID_SCOPE)', async () => {
    const withGroupId = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set(auth(owner.accessToken))
      .send(personalPayload({ groupId }))
      .expect(400);
    expect(withGroupId.body.errorCode).toBe('BUDGET_INVALID_SCOPE');

    const withoutGroupId = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set(auth(owner.accessToken))
      .send(groupPayload({ groupId: undefined }))
      .expect(400);
    expect(withoutGroupId.body.errorCode).toBe('BUDGET_INVALID_SCOPE');
  });

  // ── Category validation ──

  it('accepts system and scope-local categories; embeds the category', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set(auth(owner.accessToken))
      .send(personalPayload({ categoryId: ownerPersonalCategoryId }))
      .expect(201);
    expect(res.body.category).toMatchObject({ id: ownerPersonalCategoryId });

    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set(auth(owner.accessToken))
      .send(groupPayload({ categoryId: groupCategoryId }))
      .expect(201);
    expect(groupRes.body.categoryId).toBe(groupCategoryId);
  });

  it('rejects invalid categories with BUDGET_INVALID_CATEGORY (wrong scope / IN / deleted)', async () => {
    const cases: Array<{ payload: Record<string, unknown> }> = [
      // Someone else's personal category on my personal budget.
      { payload: personalPayload({ categoryId: memberPersonalCategoryId }) },
      // Group category on a personal budget.
      { payload: personalPayload({ categoryId: groupCategoryId }) },
      // Admin's personal category on a group budget.
      { payload: groupPayload({ categoryId: ownerPersonalCategoryId }) },
      // Direction IN system category.
      { payload: personalPayload({ categoryId: systemInCategoryId }) },
    ];
    for (const { payload } of cases) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/budgets')
        .set(auth(owner.accessToken))
        .send(payload)
        .expect(400);
      expect(res.body.errorCode).toBe('BUDGET_INVALID_CATEGORY');
    }

    // Deleted category: create + delete, then reference it.
    const doomed = await prisma.category.create({
      data: {
        slug: `bud_doomed_${suffix}`,
        name: 'Doomed',
        direction: 'OUT',
        ownerType: 'user',
        ownerId: owner.user.id,
        isSystem: false,
      },
    });
    await prisma.category.delete({ where: { id: doomed.id } });
    const res = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set(auth(owner.accessToken))
      .send(personalPayload({ categoryId: doomed.id }))
      .expect(400);
    expect(res.body.errorCode).toBe('BUDGET_INVALID_CATEGORY');
  });

  it('validates a PATCHed category against the budget scope', async () => {
    const budget = await seedBudget({
      scopeType: 'group',
      ownerId: null,
      groupId,
      currency: 'EUR',
    });
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/budgets/${budget.id}`)
      .set(auth(owner.accessToken))
      .send({ categoryId: ownerPersonalCategoryId })
      .expect(400);
    expect(res.body.errorCode).toBe('BUDGET_INVALID_CATEGORY');

    const ok = await request(app.getHttpServer())
      .patch(`/api/v1/budgets/${budget.id}`)
      .set(auth(owner.accessToken))
      .send({ categoryId: systemOutCategoryId })
      .expect(200);
    expect(ok.body.categoryId).toBe(systemOutCategoryId);
  });

  // ── Period validation ──

  it('enforces the CUSTOM / repeating period rules (BUDGET_INVALID_PERIOD)', async () => {
    const invalid: Array<Record<string, unknown>> = [
      personalPayload({ period: 'CUSTOM' }), // no bounds
      personalPayload({ period: 'CUSTOM', startsAt: '2026-07-01T00:00:00.000Z' }), // half bounds
      personalPayload({
        period: 'CUSTOM',
        startsAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2026-07-01T00:00:00.000Z', // inverted
      }),
      personalPayload({ period: 'MONTHLY', startsAt: '2026-07-01T00:00:00.000Z' }), // bounds on repeating
    ];
    for (const payload of invalid) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/budgets')
        .set(auth(owner.accessToken))
        .send(payload)
        .expect(400);
      expect(res.body.errorCode).toBe('BUDGET_INVALID_PERIOD');
    }

    const ok = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set(auth(owner.accessToken))
      .send(
        personalPayload({
          period: 'CUSTOM',
          startsAt: '2026-07-01T00:00:00.000Z',
          endsAt: '2026-08-01T00:00:00.000Z',
        }),
      )
      .expect(201);
    expect(ok.body).toMatchObject({
      period: 'CUSTOM',
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('clears CUSTOM bounds when a PATCH switches to a repeating period', async () => {
    const budget = await seedBudget({
      period: 'CUSTOM',
      startsAt: new Date('2026-07-01T00:00:00.000Z'),
      endsAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/budgets/${budget.id}`)
      .set(auth(owner.accessToken))
      .send({ period: 'WEEKLY' })
      .expect(200);
    expect(res.body).toMatchObject({ period: 'WEEKLY', startsAt: null, endsAt: null });
  });

  // ── DTO-level validation ──

  it('400s bad amounts / thresholds / currencies at the DTO layer', async () => {
    for (const payload of [
      personalPayload({ amountCents: 0 }),
      personalPayload({ amountCents: -5 }),
      personalPayload({ amountCents: 10.5 }),
      personalPayload({ alertThresholdPct: 0 }),
      personalPayload({ alertThresholdPct: 101 }),
      personalPayload({ currency: 'NOPE' }),
      personalPayload({ name: '' }),
      personalPayload({ period: 'DAILY' }),
    ]) {
      await request(app.getHttpServer())
        .post('/api/v1/budgets')
        .set(auth(owner.accessToken))
        .send(payload)
        .expect(400);
    }
  });

  // ── Archived-budget mutation rejection ──

  it('409s edits and re-archive on an archived budget; unarchive + delete stay possible', async () => {
    const budget = await seedBudget({ archivedAt: new Date() });

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/budgets/${budget.id}`)
      .set(auth(owner.accessToken))
      .send({ name: 'Nope' })
      .expect(409);
    expect(patchRes.body.errorCode).toBe('BUDGET_ARCHIVED');

    const archiveRes = await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budget.id}/archive`)
      .set(auth(owner.accessToken))
      .expect(409);
    expect(archiveRes.body.errorCode).toBe('BUDGET_ARCHIVED');

    const unarchiveRes = await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budget.id}/unarchive`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(unarchiveRes.body.archivedAt).toBeNull();

    // Re-archive via API, then hard-delete while archived.
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budget.id}/archive`)
      .set(auth(owner.accessToken))
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/budgets/${budget.id}`)
      .set(auth(owner.accessToken))
      .expect(204);
  });

  it('unarchive on an active budget is an idempotent no-op (no audit row)', async () => {
    const budget = await seedBudget();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budget.id}/unarchive`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(res.body.archivedAt).toBeNull();

    const audits = await prisma.auditLog.findMany({
      where: { entity: 'Budget', entityId: budget.id },
    });
    expect(audits).toHaveLength(0);
  });

  // ── List filters ──

  it('lists visible budgets with scope + includeArchived filters', async () => {
    const personal = await seedBudget({ name: 'Personal A' });
    const personalArchived = await seedBudget({ name: 'Personal B', archivedAt: new Date() });
    const groupBudget = await seedBudget({
      name: 'Group A',
      scopeType: 'group',
      ownerId: null,
      groupId,
      currency: 'EUR',
    });
    const memberPersonal = await prisma.budget.create({
      data: {
        name: 'Member own',
        amountCents: 500,
        currency: 'USD',
        scopeType: 'personal',
        ownerId: member.user.id,
        period: 'MONTHLY',
        createdById: member.user.id,
      },
    });

    // Default: owner sees own personal (non-archived) + group budgets.
    const all = await request(app.getHttpServer())
      .get('/api/v1/budgets')
      .set(auth(owner.accessToken))
      .expect(200);
    const allIds = all.body.data.map((b: { id: string }) => b.id);
    expect(allIds).toEqual(expect.arrayContaining([personal.id, groupBudget.id]));
    expect(allIds).not.toContain(personalArchived.id);
    expect(allIds).not.toContain(memberPersonal.id);
    expect(all.body.hasMore).toBe(false);

    // includeArchived=true reveals the archived one.
    const withArchived = await request(app.getHttpServer())
      .get('/api/v1/budgets?includeArchived=true')
      .set(auth(owner.accessToken))
      .expect(200);
    expect(withArchived.body.data.map((b: { id: string }) => b.id)).toEqual(
      expect.arrayContaining([personalArchived.id]),
    );

    // scope=personal excludes group budgets.
    const personalOnly = await request(app.getHttpServer())
      .get('/api/v1/budgets?scope=personal')
      .set(auth(owner.accessToken))
      .expect(200);
    const personalIds = personalOnly.body.data.map((b: { id: string }) => b.id);
    expect(personalIds).toContain(personal.id);
    expect(personalIds).not.toContain(groupBudget.id);

    // scope=group:<id> — member sees the group budget but not owner's personal.
    const groupOnly = await request(app.getHttpServer())
      .get(`/api/v1/budgets?scope=group:${groupId}`)
      .set(auth(member.accessToken))
      .expect(200);
    const groupIds = groupOnly.body.data.map((b: { id: string }) => b.id);
    expect(groupIds).toContain(groupBudget.id);
    expect(groupIds).not.toContain(personal.id);

    // Outsider on the group scope → 403 (mirrors GET /transactions).
    const forbidden = await request(app.getHttpServer())
      .get(`/api/v1/budgets?scope=group:${groupId}`)
      .set(auth(outsider.accessToken))
      .expect(403);
    expect(forbidden.body.errorCode).toBe('BUDGET_FORBIDDEN');

    // Outsider's default list contains none of ours.
    const outsiderList = await request(app.getHttpServer())
      .get('/api/v1/budgets')
      .set(auth(outsider.accessToken))
      .expect(200);
    expect(outsiderList.body.data).toHaveLength(0);
  });

  it('paginates the list with cursor + limit', async () => {
    for (let i = 0; i < 3; i += 1) {
      await seedBudget({ name: `Paged ${i}` });
    }

    const page1 = await request(app.getHttpServer())
      .get('/api/v1/budgets?limit=2')
      .set(auth(owner.accessToken))
      .expect(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.nextCursor).toEqual(expect.any(String));

    const page2 = await request(app.getHttpServer())
      .get(`/api/v1/budgets?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.hasMore).toBe(false);
    expect(page2.body.nextCursor).toBeNull();

    const ids = new Set([
      ...page1.body.data.map((b: { id: string }) => b.id),
      ...page2.body.data.map((b: { id: string }) => b.id),
    ]);
    expect(ids.size).toBe(3);

    await request(app.getHttpServer())
      .get('/api/v1/budgets?cursor=%21%21bad%21%21')
      .set(auth(owner.accessToken))
      .expect(400);
  });
});
