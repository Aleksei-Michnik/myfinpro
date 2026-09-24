import * as crypto from 'crypto';
import { TRANSFER_CATEGORY_SLUG } from '@myfinpro/shared';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 20 · Iteration 20.2 — transactions ⇄ accounts integration tests
 * (design §6.3). Extends the 6.5/6.6 transaction suites with the new
 * placement fields rather than growing them: create with an account, the
 * visibility / archived / currency guards, transfer validation, the
 * `accountId` filter (matching either side) and `excludeTransfers`.
 *
 * Users: `alice` (owns the accounts) and `bob` (no access to them).
 */
describe('Transactions with accounts (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let outCategoryId: string;
  let inCategoryId: string;
  let transferCategoryId: string;

  let checkingId: string;
  let savingsId: string;
  let usdAccountId: string;
  let archivedAccountId: string;
  let bobAccountId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    alice = await registerUser(app, `txacc-a-${suffix}@test.local`);
    bob = await registerUser(app, `txacc-b-${suffix}@test.local`);

    outCategoryId = (await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    }))!.id;
    inCategoryId = (await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'IN' },
    }))!.id;
    transferCategoryId = (await prisma.category.findFirst({
      where: { ownerType: 'system', slug: TRANSFER_CATEGORY_SLUG },
    }))!.id;

    const account = (name: string, over: Record<string, unknown> = {}, ownerUserId?: string) =>
      prisma.account.create({
        data: {
          name,
          kind: 'BANK',
          currency: 'ILS',
          scopeType: 'personal',
          ownerId: ownerUserId ?? alice.user.id,
          createdById: ownerUserId ?? alice.user.id,
          ...over,
        },
      });

    checkingId = (await account(`Checking ${suffix}`)).id;
    savingsId = (await account(`Savings ${suffix}`)).id;
    usdAccountId = (await account(`USD ${suffix}`, { currency: 'USD' })).id;
    archivedAccountId = (await account(`Archived ${suffix}`, { archivedAt: new Date() })).id;
    bobAccountId = (await account(`Bob ${suffix}`, {}, bob.user.id)).id;
  });

  afterAll(async () => {
    const userIds = [alice.user.id, bob.user.id];
    await prisma.transaction.deleteMany({ where: { createdById: { in: userIds } } });
    await prisma.account.deleteMany({ where: { createdById: { in: userIds } } });
    await app.close();
  });

  afterEach(async () => {
    await prisma.transaction.deleteMany({
      where: { createdById: { in: [alice.user.id, bob.user.id] } },
    });
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const payload = (over: Record<string, unknown> = {}) => ({
    direction: 'OUT',
    type: 'ONE_TIME',
    amountCents: 1250,
    currency: 'ILS',
    occurredAt: '2026-09-10',
    categoryIds: [outCategoryId],
    attributions: [{ scope: 'personal' }],
    ...over,
  });

  const create = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/v1/transactions').set(auth(token)).send(body);

  // ── create ──

  it('places a transaction on a visible account and echoes it in the summary', async () => {
    const res = await create(alice.accessToken, payload({ accountId: checkingId })).expect(201);
    expect(res.body).toMatchObject({
      accountId: checkingId,
      transferAccountId: null,
      statementLineId: null,
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${res.body.id}`)
      .set(auth(alice.accessToken))
      .expect(200);
    expect(detail.body.accountId).toBe(checkingId);
  });

  it('404s an account that is invisible, archived or nonexistent — one code', async () => {
    for (const accountId of [bobAccountId, archivedAccountId, crypto.randomUUID()]) {
      const res = await create(alice.accessToken, payload({ accountId })).expect(404);
      expect(res.body.errorCode).toBe('TRANSACTION_ACCOUNT_NOT_FOUND');
    }
  });

  it('rejects an account whose currency differs from the transaction', async () => {
    const res = await create(alice.accessToken, payload({ accountId: usdAccountId })).expect(400);
    expect(res.body.errorCode).toBe('TRANSACTION_ACCOUNT_CURRENCY_MISMATCH');
  });

  // ── transfers ──

  const transferPayload = (over: Record<string, unknown> = {}) =>
    payload({
      categoryIds: [transferCategoryId],
      accountId: checkingId,
      transferAccountId: savingsId,
      ...over,
    });

  it('creates a transfer between two own accounts', async () => {
    const res = await create(alice.accessToken, transferPayload()).expect(201);
    expect(res.body).toMatchObject({
      direction: 'OUT',
      accountId: checkingId,
      transferAccountId: savingsId,
    });
    expect(res.body.categories).toHaveLength(1);
    expect(res.body.categories[0].slug).toBe(TRANSFER_CATEGORY_SLUG);
  });

  it('requires the `transfer` system category and nothing else', async () => {
    // A spending category on a transfer row.
    const spending = await create(
      alice.accessToken,
      transferPayload({ categoryIds: [outCategoryId] }),
    ).expect(400);
    expect(spending.body.errorCode).toBe('TRANSACTION_TRANSFER_INVALID');

    // The right primary category, plus an additional one.
    const extra = await create(
      alice.accessToken,
      transferPayload({ categoryIds: [transferCategoryId, outCategoryId] }),
    ).expect(400);
    expect(extra.body.errorCode).toBe('TRANSACTION_TRANSFER_INVALID');
  });

  it('rejects turning an ordinary transaction into a transfer without recategorising', async () => {
    const created = await create(alice.accessToken, payload({ accountId: checkingId })).expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${created.body.id}`)
      .set(auth(alice.accessToken))
      .send({ transferAccountId: savingsId })
      .expect(400);
    expect(res.body.errorCode).toBe('TRANSACTION_TRANSFER_INVALID');

    const ok = await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${created.body.id}`)
      .set(auth(alice.accessToken))
      .send({ transferAccountId: savingsId, categoryIds: [transferCategoryId] })
      .expect(200);
    expect(ok.body.transferAccountId).toBe(savingsId);
  });

  it('rejects recategorising an existing transfer to a spending category', async () => {
    const created = await create(alice.accessToken, transferPayload()).expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${created.body.id}`)
      .set(auth(alice.accessToken))
      .send({ categoryIds: [outCategoryId] })
      .expect(400);
    expect(res.body.errorCode).toBe('TRANSACTION_TRANSFER_INVALID');
  });

  it('rejects malformed transfers with TRANSACTION_TRANSFER_INVALID', async () => {
    const cases: Array<Record<string, unknown>> = [
      // IN direction (with an IN category, so only the direction is at fault)
      { direction: 'IN', categoryIds: [inCategoryId] },
      // no source account
      { accountId: undefined },
      // source and destination identical
      { transferAccountId: checkingId },
      // recurring parent
      { type: 'RECURRING' },
    ];
    for (const over of cases) {
      const res = await create(alice.accessToken, transferPayload(over)).expect(400);
      expect(res.body.errorCode).toBe('TRANSACTION_TRANSFER_INVALID');
    }
  });

  it('rejects a transfer whose destination has another currency', async () => {
    const res = await create(
      alice.accessToken,
      transferPayload({ transferAccountId: usdAccountId }),
    ).expect(400);
    expect(res.body.errorCode).toBe('TRANSACTION_ACCOUNT_CURRENCY_MISMATCH');
  });

  // ── update ──

  it('moves a transaction between accounts and clears the placement with null', async () => {
    const created = await create(alice.accessToken, payload({ accountId: checkingId })).expect(201);

    const moved = await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${created.body.id}`)
      .set(auth(alice.accessToken))
      .send({ accountId: savingsId })
      .expect(200);
    expect(moved.body.accountId).toBe(savingsId);

    const cleared = await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${created.body.id}`)
      .set(auth(alice.accessToken))
      .send({ accountId: null })
      .expect(200);
    expect(cleared.body.accountId).toBeNull();
  });

  it('re-validates the account when the currency changes', async () => {
    const created = await create(alice.accessToken, payload({ accountId: checkingId })).expect(201);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${created.body.id}`)
      .set(auth(alice.accessToken))
      .send({ currency: 'USD' })
      .expect(400);
    expect(res.body.errorCode).toBe('TRANSACTION_ACCOUNT_CURRENCY_MISMATCH');
  });

  // ── list filters ──

  it('filters by accountId on both sides and honours excludeTransfers', async () => {
    const plain = await create(alice.accessToken, payload({ accountId: checkingId })).expect(201);
    const transfer = await create(alice.accessToken, transferPayload({ amountCents: 5000 })).expect(
      201,
    );
    const unplaced = await create(alice.accessToken, payload({ amountCents: 700 })).expect(201);

    const onChecking = await request(app.getHttpServer())
      .get(`/api/v1/transactions?accountId=${checkingId}`)
      .set(auth(alice.accessToken))
      .expect(200);
    expect(onChecking.body.data.map((t: { id: string }) => t.id).sort()).toEqual(
      [plain.body.id, transfer.body.id].sort(),
    );

    // The destination account sees the same transfer row — the other side.
    const onSavings = await request(app.getHttpServer())
      .get(`/api/v1/transactions?accountId=${savingsId}`)
      .set(auth(alice.accessToken))
      .expect(200);
    expect(onSavings.body.data.map((t: { id: string }) => t.id)).toEqual([transfer.body.id]);

    const noTransfers = await request(app.getHttpServer())
      .get('/api/v1/transactions?excludeTransfers=true')
      .set(auth(alice.accessToken))
      .expect(200);
    const ids = noTransfers.body.data.map((t: { id: string }) => t.id);
    expect(ids).toEqual(expect.arrayContaining([plain.body.id, unplaced.body.id]));
    expect(ids).not.toContain(transfer.body.id);
  });

  it('returns nothing for an account the caller cannot see', async () => {
    await create(alice.accessToken, payload({ accountId: checkingId })).expect(201);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/transactions?accountId=${checkingId}`)
      .set(auth(bob.accessToken))
      .expect(200);
    expect(res.body.data).toEqual([]);
  });

  // ── account deletion ──

  it('unplaces transactions when their account is deleted, keeping the amounts', async () => {
    const disposable = await prisma.account.create({
      data: {
        name: `Disposable ${suffix}`,
        kind: 'BANK',
        currency: 'ILS',
        scopeType: 'personal',
        ownerId: alice.user.id,
        createdById: alice.user.id,
      },
    });
    const created = await create(alice.accessToken, payload({ accountId: disposable.id })).expect(
      201,
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/accounts/${disposable.id}`)
      .set(auth(alice.accessToken))
      .expect(204);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${created.body.id}`)
      .set(auth(alice.accessToken))
      .expect(200);
    expect(after.body.accountId).toBeNull();
    expect(after.body.amountCents).toBe(1250);
  });
});
