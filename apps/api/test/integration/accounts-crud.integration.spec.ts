import * as crypto from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 20 · Iteration 20.2 — /accounts CRUD + archive integration tests.
 *
 * Bootstraps the real AppModule against the env DB (same pattern as
 * budgets-crud.integration.spec.ts) and exercises the endpoints end-to-end:
 * auth, the scope/role matrix (owner / group admin / group member /
 * outsider), institution and billing validation, immutable scope + currency,
 * archived-account mutation rejection, audit rows, and the derived ledger
 * balance (including a transfer and a negative opening balance).
 *
 * Users: `owner` (personal accounts + admin of the group), `member` (group
 * member, read-only on group accounts), `outsider` (no access). Fixtures are
 * seeded via Prisma directly so the suite stays well under the 30/min
 * mutation throttle per route.
 */
describe('Accounts API (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let owner: Awaited<ReturnType<typeof registerUser>>;
  let member: Awaited<ReturnType<typeof registerUser>>;
  let outsider: Awaited<ReturnType<typeof registerUser>>;
  let groupId: string;
  let outCategoryId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    owner = await registerUser(app, `acc-owner-${suffix}@test.local`);
    member = await registerUser(app, `acc-member-${suffix}@test.local`);
    outsider = await registerUser(app, `acc-outsider-${suffix}@test.local`);

    await prisma.user.update({
      where: { id: owner.user.id },
      data: { defaultCurrency: 'ILS' },
    });

    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Account Fam', type: 'family' })
      .expect(201);
    groupId = groupRes.body.id;
    await prisma.group.update({ where: { id: groupId }, data: { defaultCurrency: 'EUR' } });
    await prisma.groupMembership.create({
      data: { groupId, userId: member.user.id, role: 'member' },
    });

    const outCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT' },
    });
    outCategoryId = outCat!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    const userIds = [owner.user.id, member.user.id, outsider.user.id];
    await prisma.transaction.deleteMany({ where: { createdById: { in: userIds } } });
    await prisma.account.deleteMany({ where: { createdById: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { entity: 'Account', userId: { in: userIds } } });
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const personalPayload = (over: Record<string, unknown> = {}) => ({
    name: 'Everyday checking',
    kind: 'BANK',
    scopeType: 'personal',
    currency: 'ILS',
    ...over,
  });

  const groupPayload = (over: Record<string, unknown> = {}) => ({
    name: 'Household card',
    kind: 'CARD',
    scopeType: 'group',
    groupId,
    currency: 'EUR',
    ...over,
  });

  /** Seed an account row directly (keeps the suite under the throttle). */
  const seedAccount = (over: Record<string, unknown> = {}) =>
    prisma.account.create({
      data: {
        name: 'Seeded',
        kind: 'BANK',
        currency: 'ILS',
        scopeType: 'personal',
        ownerId: owner.user.id,
        groupId: null,
        createdById: owner.user.id,
        ...over,
      },
    });

  /** Seed a transaction directly, so ledger sums have something to add up. */
  const seedTransaction = (over: Record<string, unknown> = {}) =>
    prisma.transaction.create({
      data: {
        direction: 'OUT',
        type: 'ONE_TIME',
        amountCents: 1000,
        currency: 'ILS',
        occurredAt: new Date('2026-09-10T12:00:00.000Z'),
        status: 'POSTED',
        categoryId: outCategoryId,
        createdById: owner.user.id,
        attributions: { create: [{ scopeType: 'personal', userId: owner.user.id }] },
        ...over,
      },
    });

  // ── personal owner CRUD ──

  it('owner creates / reads / edits / deletes a personal account; audits each step', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/accounts')
      .set(auth(owner.accessToken))
      .send(
        personalPayload({
          institution: 'hapoalim',
          last4: '4321',
          openingBalanceCents: 250_00,
          openingBalanceAt: '2026-09-01T00:00:00.000Z',
        }),
      )
      .expect(201);

    const id = createRes.body.id as string;
    expect(createRes.body).toMatchObject({
      name: 'Everyday checking',
      kind: 'BANK',
      institution: 'hapoalim',
      currency: 'ILS',
      last4: '4321',
      scopeType: 'personal',
      ownerId: owner.user.id,
      groupId: null,
      openingBalanceCents: 250_00,
      reportedBalanceCents: null,
      reconciliationGapCents: null,
      billingAccountId: null,
      billingDay: null,
      archivedAt: null,
      createdById: owner.user.id,
      ledgerBalanceCents: 250_00,
      pendingLinesCount: 0,
    });
    expect(createRes.body.ledgerBalanceAt).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .get(`/api/v1/accounts/${id}`)
      .set(auth(owner.accessToken))
      .expect(200);

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/accounts/${id}`)
      .set(auth(owner.accessToken))
      .send({ name: 'Main checking', last4: '99', color: '#1f6feb' })
      .expect(200);
    expect(patchRes.body).toMatchObject({
      name: 'Main checking',
      last4: '99',
      color: '#1f6feb',
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/accounts/${id}`)
      .set(auth(owner.accessToken))
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/accounts/${id}`)
      .set(auth(owner.accessToken))
      .expect(404);

    const audits = await prisma.auditLog.findMany({ where: { entity: 'Account', entityId: id } });
    expect(audits.map((a) => a.action).sort()).toEqual([
      'ACCOUNT_CREATED',
      'ACCOUNT_DELETED',
      'ACCOUNT_UPDATED',
    ]);
    expect(audits.every((a) => a.userId === owner.user.id)).toBe(true);
  });

  it("defaults currency to the owner's defaultCurrency when omitted", async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/accounts')
      .set(auth(owner.accessToken))
      .send(personalPayload({ currency: undefined }))
      .expect(201);
    expect(res.body.currency).toBe('ILS');
  });

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/api/v1/accounts').expect(401);
    await request(app.getHttpServer()).post('/api/v1/accounts').send(personalPayload()).expect(401);
  });

  // ── outsider on a personal account → 404, never a leak ──

  it('404s every outsider operation on a personal account (ACCOUNT_NOT_FOUND)', async () => {
    const account = await seedAccount();

    for (const [method, url] of [
      ['get', `/api/v1/accounts/${account.id}`],
      ['patch', `/api/v1/accounts/${account.id}`],
      ['delete', `/api/v1/accounts/${account.id}`],
      ['post', `/api/v1/accounts/${account.id}/archive`],
      ['post', `/api/v1/accounts/${account.id}/unarchive`],
    ] as const) {
      const res = await request(app.getHttpServer())
        [method](url)
        .set(auth(outsider.accessToken))
        .send(method === 'patch' ? { name: 'Hijack' } : undefined)
        .expect(404);
      expect(res.body.errorCode).toBe('ACCOUNT_NOT_FOUND');
    }
  });

  it('404s a nonexistent account id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${crypto.randomUUID()}`)
      .set(auth(owner.accessToken))
      .expect(404);
    expect(res.body.errorCode).toBe('ACCOUNT_NOT_FOUND');
  });

  // ── group scope matrix ──

  it('group admin creates a group account; member reads it; outsider 404s', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/accounts')
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
      .get(`/api/v1/accounts/${id}`)
      .set(auth(member.accessToken))
      .expect(200);
    expect(memberRes.body.id).toBe(id);

    const outsiderRes = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${id}`)
      .set(auth(outsider.accessToken))
      .expect(404);
    expect(outsiderRes.body.errorCode).toBe('ACCOUNT_NOT_FOUND');
  });

  it('403s a group member (non-admin) on every mutation (ACCOUNT_FORBIDDEN)', async () => {
    const account = await seedAccount({
      scopeType: 'group',
      ownerId: null,
      groupId,
      currency: 'EUR',
    });

    for (const [method, url] of [
      ['patch', `/api/v1/accounts/${account.id}`],
      ['delete', `/api/v1/accounts/${account.id}`],
      ['post', `/api/v1/accounts/${account.id}/archive`],
      ['post', `/api/v1/accounts/${account.id}/unarchive`],
    ] as const) {
      const res = await request(app.getHttpServer())
        [method](url)
        .set(auth(member.accessToken))
        .send(method === 'patch' ? { name: 'Hijack' } : undefined)
        .expect(403);
      expect(res.body.errorCode).toBe('ACCOUNT_FORBIDDEN');
    }
  });

  it('403s a member creating a group account and 404s a non-member', async () => {
    const memberRes = await request(app.getHttpServer())
      .post('/api/v1/accounts')
      .set(auth(member.accessToken))
      .send(groupPayload())
      .expect(403);
    expect(memberRes.body.errorCode).toBe('ACCOUNT_FORBIDDEN');

    const outsiderRes = await request(app.getHttpServer())
      .post('/api/v1/accounts')
      .set(auth(outsider.accessToken))
      .send(groupPayload())
      .expect(404);
    expect(outsiderRes.body.errorCode).toBe('ACCOUNT_INVALID_SCOPE');
  });

  it('403s a group scope the caller is not a member of on list', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/accounts?scope=group:${groupId}`)
      .set(auth(outsider.accessToken))
      .expect(403);
    expect(res.body.errorCode).toBe('ACCOUNT_FORBIDDEN');
  });

  // ── validation ──

  it('rejects an institution that does not issue the account kind', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/accounts')
      .set(auth(owner.accessToken))
      .send(personalPayload({ kind: 'BANK', institution: 'isracard' }))
      .expect(400);
    expect(res.body.errorCode).toBe('ACCOUNT_INVALID_INSTITUTION');
  });

  it('rejects an unknown institution, a bad kind and a malformed last4 at the DTO', async () => {
    for (const body of [
      personalPayload({ institution: 'unknown-bank' }),
      personalPayload({ kind: 'CRYPTO' }),
      personalPayload({ last4: '12345' }),
      personalPayload({ last4: 'abcd' }),
    ]) {
      await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set(auth(owner.accessToken))
        .send(body)
        .expect(400);
    }
  });

  it('accepts a CARD billed by a BANK account in the same scope and currency', async () => {
    const bank = await seedAccount({ name: 'Billing bank' });

    const res = await request(app.getHttpServer())
      .post('/api/v1/accounts')
      .set(auth(owner.accessToken))
      .send(
        personalPayload({
          name: 'Isracard',
          kind: 'CARD',
          institution: 'isracard',
          billingAccountId: bank.id,
          billingDay: 10,
        }),
      )
      .expect(201);
    expect(res.body).toMatchObject({ billingAccountId: bank.id, billingDay: 10 });
  });

  it('rejects invalid billing setups with ACCOUNT_INVALID_BILLING', async () => {
    const bank = await seedAccount({ name: 'Billing bank' });
    const wrongCurrency = await seedAccount({ name: 'USD bank', currency: 'USD' });
    const archivedBank = await seedAccount({ name: 'Old bank', archivedAt: new Date() });
    const groupBank = await seedAccount({
      name: 'Group bank',
      scopeType: 'group',
      ownerId: null,
      groupId,
    });
    const otherCard = await seedAccount({ name: 'Other card', kind: 'CARD' });

    const cases: Array<Record<string, unknown>> = [
      // billing fields on a non-CARD account
      personalPayload({ billingAccountId: bank.id }),
      // billingDay without an account
      personalPayload({ kind: 'CARD', billingDay: 10 }),
      // billing account of the wrong kind / currency / state / scope
      personalPayload({ kind: 'CARD', billingAccountId: otherCard.id }),
      personalPayload({ kind: 'CARD', billingAccountId: wrongCurrency.id }),
      personalPayload({ kind: 'CARD', billingAccountId: archivedBank.id }),
      personalPayload({ kind: 'CARD', billingAccountId: groupBank.id }),
      // an account the caller cannot see at all
      personalPayload({ kind: 'CARD', billingAccountId: crypto.randomUUID() }),
    ];

    for (const body of cases) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set(auth(owner.accessToken))
        .send(body)
        .expect(400);
      expect(res.body.errorCode).toBe('ACCOUNT_INVALID_BILLING');
    }
  });

  it('rejects billingDay outside 1..28', async () => {
    const bank = await seedAccount();
    for (const billingDay of [0, 29, 31]) {
      await request(app.getHttpServer())
        .post('/api/v1/accounts')
        .set(auth(owner.accessToken))
        .send(personalPayload({ kind: 'CARD', billingAccountId: bank.id, billingDay }))
        .expect(400);
    }
  });

  it('keeps scope and currency immutable (ACCOUNT_INVALID_SCOPE)', async () => {
    const account = await seedAccount();
    for (const body of [{ currency: 'USD' }, { scopeType: 'group' }, { groupId }]) {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/accounts/${account.id}`)
        .set(auth(owner.accessToken))
        .send(body)
        .expect(400);
      expect(res.body.errorCode).toBe('ACCOUNT_INVALID_SCOPE');
    }

    // Echoing the current values back is a no-op, not an error.
    await request(app.getHttpServer())
      .patch(`/api/v1/accounts/${account.id}`)
      .set(auth(owner.accessToken))
      .send({ currency: 'ILS', scopeType: 'personal' })
      .expect(200);
  });

  // ── archive lifecycle ──

  it('archives, hides from the default list, rejects edits, then unarchives', async () => {
    const account = await seedAccount({ name: 'Archivable' });

    const archived = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${account.id}/archive`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(archived.body.archivedAt).not.toBeNull();

    const hidden = await request(app.getHttpServer())
      .get('/api/v1/accounts')
      .set(auth(owner.accessToken))
      .expect(200);
    expect(hidden.body.data.map((a: { id: string }) => a.id)).not.toContain(account.id);

    const shown = await request(app.getHttpServer())
      .get('/api/v1/accounts?includeArchived=true')
      .set(auth(owner.accessToken))
      .expect(200);
    expect(shown.body.data.map((a: { id: string }) => a.id)).toContain(account.id);

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/accounts/${account.id}`)
      .set(auth(owner.accessToken))
      .send({ name: 'Nope' })
      .expect(409);
    expect(patchRes.body.errorCode).toBe('ACCOUNT_ARCHIVED');

    const twice = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${account.id}/archive`)
      .set(auth(owner.accessToken))
      .expect(409);
    expect(twice.body.errorCode).toBe('ACCOUNT_ARCHIVED');

    const unarchived = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${account.id}/unarchive`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(unarchived.body.archivedAt).toBeNull();

    // Idempotent — unarchiving an active account is a no-op.
    await request(app.getHttpServer())
      .post(`/api/v1/accounts/${account.id}/unarchive`)
      .set(auth(owner.accessToken))
      .expect(200);
  });

  // ── derived ledger balance ──

  it('derives the ledger balance from countable transactions and transfers', async () => {
    const anchor = new Date('2026-09-01T00:00:00.000Z');
    const checking = await seedAccount({
      name: 'Ledger checking',
      openingBalanceCents: 1_000_00,
      openingBalanceAt: anchor,
    });
    const savings = await seedAccount({
      name: 'Ledger savings',
      openingBalanceCents: 0,
      openingBalanceAt: anchor,
    });

    // Counted: POSTED one-time rows on or after the anchor.
    await seedTransaction({ direction: 'OUT', amountCents: 150_00, accountId: checking.id });
    await seedTransaction({ direction: 'IN', amountCents: 40_00, accountId: checking.id });
    // A transfer: leaves checking, arrives in savings, one row.
    await seedTransaction({
      direction: 'OUT',
      amountCents: 300_00,
      accountId: checking.id,
      transferAccountId: savings.id,
    });
    // Not counted: before the anchor, not POSTED, and a recurring template.
    await seedTransaction({
      amountCents: 999_00,
      accountId: checking.id,
      occurredAt: new Date('2026-08-20T12:00:00.000Z'),
    });
    await seedTransaction({ amountCents: 888_00, accountId: checking.id, status: 'PENDING' });
    await seedTransaction({ amountCents: 777_00, accountId: checking.id, type: 'RECURRING' });

    const res = await request(app.getHttpServer())
      .get('/api/v1/accounts')
      .set(auth(owner.accessToken))
      .expect(200);

    const byId = new Map<string, { ledgerBalanceCents: number }>(
      res.body.data.map((a: { id: string; ledgerBalanceCents: number }) => [a.id, a]),
    );
    expect(byId.get(checking.id)!.ledgerBalanceCents).toBe(1_000_00 - 150_00 + 40_00 - 300_00);
    expect(byId.get(savings.id)!.ledgerBalanceCents).toBe(300_00);
  });

  it('supports a negative opening balance (a card that owes money)', async () => {
    const card = await seedAccount({
      name: 'Owed card',
      kind: 'CARD',
      openingBalanceCents: -450_00,
      openingBalanceAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    await seedTransaction({ direction: 'OUT', amountCents: 50_00, accountId: card.id });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${card.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(res.body.ledgerBalanceCents).toBe(-500_00);
  });

  it('reports the reconciliation gap against the bank figure as of its date', async () => {
    const account = await seedAccount({
      name: 'Gapped',
      openingBalanceCents: 100_00,
      openingBalanceAt: new Date('2026-09-01T00:00:00.000Z'),
      reportedBalanceCents: 120_00,
      reportedBalanceAt: new Date('2026-09-15T00:00:00.000Z'),
    });
    // Before the bank date — inside the gap window.
    await seedTransaction({
      direction: 'IN',
      amountCents: 10_00,
      accountId: account.id,
      occurredAt: new Date('2026-09-05T12:00:00.000Z'),
    });
    // After the bank date — in the ledger, outside the gap window.
    await seedTransaction({
      direction: 'IN',
      amountCents: 5_00,
      accountId: account.id,
      occurredAt: new Date('2026-09-20T12:00:00.000Z'),
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${account.id}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(res.body.ledgerBalanceCents).toBe(115_00);
    expect(res.body.reconciliationGapCents).toBe(120_00 - 110_00);
  });

  // ── list ──

  it('lists the visibility union and narrows by scope', async () => {
    const personal = await seedAccount({ name: 'Mine' });
    const group = await seedAccount({
      name: 'Ours',
      scopeType: 'group',
      ownerId: null,
      groupId,
      currency: 'EUR',
    });

    const all = await request(app.getHttpServer())
      .get('/api/v1/accounts')
      .set(auth(owner.accessToken))
      .expect(200);
    const allIds = all.body.data.map((a: { id: string }) => a.id);
    expect(allIds).toEqual(expect.arrayContaining([personal.id, group.id]));

    const personalOnly = await request(app.getHttpServer())
      .get('/api/v1/accounts?scope=personal')
      .set(auth(owner.accessToken))
      .expect(200);
    expect(personalOnly.body.data.map((a: { id: string }) => a.id)).toEqual([personal.id]);

    // The member sees the group account and none of the owner's personal ones.
    const memberList = await request(app.getHttpServer())
      .get('/api/v1/accounts')
      .set(auth(member.accessToken))
      .expect(200);
    const memberIds = memberList.body.data.map((a: { id: string }) => a.id);
    expect(memberIds).toContain(group.id);
    expect(memberIds).not.toContain(personal.id);
  });

  it('paginates with an opaque cursor', async () => {
    await seedAccount({ name: 'Page 1' });
    await seedAccount({ name: 'Page 2' });

    const first = await request(app.getHttpServer())
      .get('/api/v1/accounts?scope=personal&limit=1')
      .set(auth(owner.accessToken))
      .expect(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.hasMore).toBe(true);

    const second = await request(app.getHttpServer())
      .get(
        `/api/v1/accounts?scope=personal&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      )
      .set(auth(owner.accessToken))
      .expect(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
  });

  it('rejects a malformed cursor', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/accounts?cursor=not-a-cursor')
      .set(auth(owner.accessToken))
      .expect(400);
  });
});
