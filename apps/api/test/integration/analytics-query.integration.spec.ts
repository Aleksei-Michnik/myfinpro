import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 9.1 — POST /analytics/query integration tests.
 *
 * Exercises the hybrid-grain engine against a fixture set that covers every
 * row source (design §2.1): manual header rows, item rows, a balancing row
 * (receipt disagreeing with its transaction), a recurring template + its
 * occurrence, a PENDING plan child, dual attribution, multi-currency, and a
 * foreign user's invisible spend.
 *
 * Central invariant (design §2.1): Σ(purchase rows) ≡ Σ(countable
 * transaction amounts) — asserted per dimension set.
 */
describe('POST /analytics/query (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let carol: Awaited<ReturnType<typeof registerUser>>;
  let groupId: string;
  let carolGroupId: string;

  let catHome: string;
  let catGroceries: string;
  let catRestaurants: string;
  let catTransport: string;
  let catIn: string;

  let merchantId: string;
  let productMilk: string;
  let productSoap: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const JUNE = { dateFrom: '2026-06-01T00:00:00.000Z', dateTo: '2026-07-01T00:00:00.000Z' };

  const runQuery = async (
    token: string,
    body: Record<string, unknown>,
  ): Promise<{
    status: number;
    body: {
      data: Array<{
        keys: Record<string, { id: string | null; name: string | null } | string | undefined> & {
          scope?: { scopeType: string; group?: { id: string | null; name: string | null } };
        };
        currency: string;
        spendCents: number;
        transactionCount: number;
        itemCount: number;
      }>;
      cursor: string | null;
      hasMore: boolean;
      errorCode?: string;
    };
  }> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/analytics/query')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    return { status: res.status, body: res.body };
  };

  /** POST /transactions convenience with sane defaults. */
  const createTransaction = async (
    token: string,
    over: Record<string, unknown>,
  ): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        direction: 'OUT',
        type: 'ONE_TIME',
        currency: 'USD',
        attributions: [{ scope: 'personal' }],
        ...over,
      })
      .expect(201);
    return res.body.id as string;
  };

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    alice = await registerUser(app, `an-a-${suffix}@test.local`, 'SecurePass123', 'Alice A');
    bob = await registerUser(app, `an-b-${suffix}@test.local`, 'SecurePass123', 'Bob B');
    carol = await registerUser(app, `an-c-${suffix}@test.local`, 'SecurePass123', 'Carol C');

    // Alice creates a group; Bob joins directly via Prisma (invite flow is
    // covered by Phase 5 tests). Carol has her own group Alice cannot see.
    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: `Analytics Fam ${suffix}`, type: 'family' })
      .expect(201);
    groupId = groupRes.body.id;
    await prisma.groupMembership.create({
      data: { groupId, userId: bob.user.id, role: 'member' },
    });
    const carolGroupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${carol.accessToken}`)
      .send({ name: `Carol Fam ${suffix}`, type: 'family' })
      .expect(201);
    carolGroupId = carolGroupRes.body.id;

    const bySlug = async (slug: string, direction: string): Promise<string> => {
      const cat = await prisma.category.findFirst({
        where: { ownerType: 'system', direction, slug },
      });
      return cat!.id;
    };
    catHome = await bySlug('home', 'OUT');
    catGroceries = await bySlug('groceries', 'OUT');
    catRestaurants = await bySlug('restaurants', 'OUT');
    catTransport = await bySlug('transport', 'OUT');
    const inCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'IN' },
    });
    catIn = inCat!.id;

    merchantId = (
      await prisma.merchant.create({
        data: { name: `SuperMart ${suffix}`, normalizedName: `supermart ${suffix}` },
      })
    ).id;
    productMilk = (
      await prisma.product.create({
        data: { name: `Milk ${suffix}`, normalizedName: `milk ${suffix}` },
      })
    ).id;
    productSoap = (
      await prisma.product.create({
        data: { name: `Soap ${suffix}`, normalizedName: `soap ${suffix}` },
      })
    ).id;

    // ── Fixtures (design §2.1 row sources) ──

    // T1 — manual header row.
    await createTransaction(alice.accessToken, {
      amountCents: 400000,
      occurredAt: '2026-06-05T12:00:00.000Z',
      categoryId: catHome,
    });

    // T2 — receipted, items sum exactly (3 item rows, no balancing row).
    const t2 = await createTransaction(alice.accessToken, {
      amountCents: 35000,
      occurredAt: '2026-06-10T12:00:00.000Z',
      categoryId: catGroceries,
    });
    const r2 = await prisma.receipt.create({
      data: {
        status: 'CONFIRMED',
        uploadedById: alice.user.id,
        transactionId: t2,
        merchantId,
        currency: 'USD',
        totalCents: 35000,
        purchasedAt: new Date('2026-06-10T11:00:00.000Z'),
      },
    });
    await prisma.receiptItem.createMany({
      data: [
        {
          receiptId: r2.id,
          position: 1,
          rawName: 'Milk 3%',
          quantity: 2,
          totalCents: 28000,
          categoryId: catRestaurants,
          productId: productMilk,
          purchasedAt: new Date('2026-06-10T11:00:00.000Z'),
        },
        {
          receiptId: r2.id,
          position: 2,
          rawName: 'Soap',
          quantity: 1,
          totalCents: 5000,
          categoryId: catTransport,
          productId: productSoap,
          purchasedAt: new Date('2026-06-10T11:00:00.000Z'),
        },
        // No category (falls back to the header category), no product.
        {
          receiptId: r2.id,
          position: 3,
          rawName: 'Bag',
          quantity: 1,
          totalCents: 2000,
          purchasedAt: new Date('2026-06-10T11:00:00.000Z'),
        },
      ],
    });

    // T3 — receipted with a receipt-level discount: item 11000, header
    // 10000 → balancing row of −1000 on the header category.
    const t3 = await createTransaction(alice.accessToken, {
      amountCents: 10000,
      occurredAt: '2026-06-12T12:00:00.000Z',
      categoryId: catGroceries,
    });
    const r3 = await prisma.receipt.create({
      data: {
        status: 'CONFIRMED',
        uploadedById: alice.user.id,
        transactionId: t3,
        merchantId,
        currency: 'USD',
        totalCents: 10000,
        discountCents: 1000,
      },
    });
    await prisma.receiptItem.create({
      data: {
        receiptId: r3.id,
        position: 1,
        rawName: 'Milk 3%',
        quantity: 1,
        totalCents: 11000,
        categoryId: catRestaurants,
        productId: productMilk,
        purchasedAt: new Date('2026-06-12T11:00:00.000Z'),
      },
    });

    // T4 — Bob's group-attributed spend.
    await createTransaction(bob.accessToken, {
      amountCents: 20000,
      occurredAt: '2026-06-15T12:00:00.000Z',
      categoryId: catRestaurants,
      attributions: [{ scope: 'group', groupId }],
    });

    // T5 — dual attribution (personal + group): fan-out fixture.
    await createTransaction(alice.accessToken, {
      amountCents: 5000,
      occurredAt: '2026-06-20T12:00:00.000Z',
      categoryId: catRestaurants,
      attributions: [{ scope: 'personal' }, { scope: 'group', groupId }],
    });

    // T6 — EUR spend: must never mix with USD buckets.
    await createTransaction(alice.accessToken, {
      amountCents: 3000,
      currency: 'EUR',
      occurredAt: '2026-06-21T12:00:00.000Z',
      categoryId: catRestaurants,
    });

    // T7 — income.
    await createTransaction(alice.accessToken, {
      direction: 'IN',
      amountCents: 500000,
      occurredAt: '2026-06-25T12:00:00.000Z',
      categoryId: catIn,
    });

    // T8 — Carol's spend, invisible to Alice/Bob.
    await createTransaction(carol.accessToken, {
      amountCents: 99900,
      occurredAt: '2026-06-18T12:00:00.000Z',
      categoryId: catGroceries,
    });

    // T9 — recurring template (excluded) + POSTED occurrence (counted) +
    // PENDING plan-style child (excluded).
    const t9parent = await prisma.transaction.create({
      data: {
        direction: 'OUT',
        type: 'RECURRING',
        amountCents: 7700,
        currency: 'USD',
        occurredAt: new Date('2026-06-01T12:00:00.000Z'),
        status: 'POSTED',
        categoryId: catHome,
        createdById: alice.user.id,
        attributions: { create: [{ scopeType: 'personal', userId: alice.user.id }] },
      },
    });
    await prisma.transaction.create({
      data: {
        direction: 'OUT',
        type: 'ONE_TIME',
        amountCents: 7700,
        currency: 'USD',
        occurredAt: new Date('2026-06-25T12:00:00.000Z'),
        status: 'POSTED',
        categoryId: catHome,
        createdById: alice.user.id,
        parentTransactionId: t9parent.id,
        idempotencyKey: `analytics-it-${suffix}`,
        attributions: { create: [{ scopeType: 'personal', userId: alice.user.id }] },
      },
    });
    await prisma.transaction.create({
      data: {
        direction: 'OUT',
        type: 'ONE_TIME',
        amountCents: 8800,
        currency: 'USD',
        occurredAt: new Date('2026-06-28T12:00:00.000Z'),
        status: 'PENDING',
        categoryId: catHome,
        createdById: alice.user.id,
        parentTransactionId: t9parent.id,
        attributions: { create: [{ scopeType: 'personal', userId: alice.user.id }] },
      },
    });

    // T10 — May spend (period-dimension fixture, outside the June filters).
    await createTransaction(alice.accessToken, {
      amountCents: 6000,
      occurredAt: '2026-05-10T12:00:00.000Z',
      categoryId: catHome,
    });
  }, 120_000);

  afterAll(async () => {
    if (app) {
      const userIds = [alice.user.id, bob.user.id, carol.user.id];
      await prisma.receipt.deleteMany({ where: { uploadedById: { in: userIds } } });
      await prisma.transaction.deleteMany({ where: { createdById: { in: userIds } } });
      await prisma.product.deleteMany({ where: { id: { in: [productMilk, productSoap] } } });
      await prisma.merchant.deleteMany({ where: { id: merchantId } });
      await prisma.group.deleteMany({ where: { id: { in: [groupId, carolGroupId] } } });
      await app.close();
    }
  }, 30_000);

  // Expected June/USD totals visible to Alice:
  //   T1 400000 + T2 35000 + T3 10000 + T4 20000 + T5 5000 + T9occ 7700 = 477700
  const JUNE_USD_TOTAL = 477700;

  it('returns exact grand totals per currency (Σ invariant, zero dimensions)', async () => {
    const res = await runQuery(alice.accessToken, { dimensions: [], filters: { ...JUNE } });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    const usd = res.body.data.find((r) => r.currency === 'USD')!;
    expect(usd.spendCents).toBe(JUNE_USD_TOTAL);
    expect(usd.transactionCount).toBe(6);
    expect(usd.itemCount).toBe(4);

    const eur = res.body.data.find((r) => r.currency === 'EUR')!;
    expect(eur.spendCents).toBe(3000);
    expect(eur.transactionCount).toBe(1);
    expect(eur.itemCount).toBe(0);
  });

  it('groups by category at hybrid grain (items + header fallback + balancing)', async () => {
    const res = await runQuery(alice.accessToken, {
      dimensions: ['category'],
      filters: { ...JUNE, currencies: ['USD'] },
    });
    expect(res.status).toBe(200);

    const byId = new Map(res.body.data.map((r) => [(r.keys.category as { id: string }).id, r]));
    expect(byId.get(catHome)?.spendCents).toBe(407700); // T1 + T9 occurrence
    expect(byId.get(catRestaurants)?.spendCents).toBe(64000); // i1 + T3 item + T4 + T5
    expect(byId.get(catTransport)?.spendCents).toBe(5000); // i2
    // Header-fallback item (2000) + balancing row (−1000).
    expect(byId.get(catGroceries)?.spendCents).toBe(1000);

    const sum = res.body.data.reduce((acc, r) => acc + r.spendCents, 0);
    expect(sum).toBe(JUNE_USD_TOTAL); // the invariant survives the category split

    expect((byId.get(catHome)!.keys.category as { name: string }).name).toBe('Home');
  });

  it('groups by merchant with a null bucket for unreceipted spend', async () => {
    const res = await runQuery(alice.accessToken, {
      dimensions: ['merchant'],
      filters: { ...JUNE, currencies: ['USD'] },
    });
    expect(res.status).toBe(200);

    const m1 = res.body.data.find(
      (r) => (r.keys.merchant as { id: string | null }).id === merchantId,
    )!;
    expect(m1.spendCents).toBe(45000); // T2 + T3 (items + balancing)
    expect(m1.transactionCount).toBe(2);
    expect(m1.itemCount).toBe(4);
    expect((m1.keys.merchant as { name: string }).name).toBe(`SuperMart ${suffix}`);

    const none = res.body.data.find((r) => (r.keys.merchant as { id: string | null }).id === null)!;
    expect(none.spendCents).toBe(432700);
  });

  it('groups by product; a productIds filter selects item rows only', async () => {
    const res = await runQuery(alice.accessToken, {
      dimensions: ['product'],
      filters: { ...JUNE, currencies: ['USD'] },
    });
    const byId = new Map(
      res.body.data.map((r) => [(r.keys.product as { id: string | null }).id, r]),
    );
    expect(byId.get(productMilk)?.spendCents).toBe(39000); // 28000 + 11000
    expect(byId.get(productMilk)?.itemCount).toBe(2);
    expect(byId.get(productSoap)?.spendCents).toBe(5000);
    expect(byId.get(null)?.spendCents).toBe(433700); // headers + fallback item + balancing

    const filtered = await runQuery(alice.accessToken, {
      dimensions: [],
      filters: { ...JUNE, productIds: [productMilk] },
    });
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].spendCents).toBe(39000);
    expect(filtered.body.data[0].transactionCount).toBe(2);
  });

  it('groups by member (transaction creator)', async () => {
    const res = await runQuery(alice.accessToken, {
      dimensions: ['member'],
      filters: { ...JUNE, currencies: ['USD'] },
    });
    const byId = new Map(res.body.data.map((r) => [(r.keys.member as { id: string }).id, r]));
    expect(byId.get(alice.user.id)?.spendCents).toBe(457700);
    expect(byId.get(bob.user.id)?.spendCents).toBe(20000);
    expect((byId.get(bob.user.id)!.keys.member as { name: string }).name).toBe('Bob B');
  });

  it('scope dimension fans out dual attributions (documented semantics)', async () => {
    const res = await runQuery(alice.accessToken, {
      dimensions: ['scope'],
      filters: { ...JUNE, currencies: ['USD'] },
    });
    expect(res.status).toBe(200);

    const personal = res.body.data.find((r) => r.keys.scope!.scopeType === 'personal')!;
    const group = res.body.data.find((r) => r.keys.scope!.scopeType === 'group')!;
    expect(personal.spendCents).toBe(457700); // T1,T2,T3,T5,T9occ
    expect(group.spendCents).toBe(25000); // T4 + T5 (T5 counted here too)
    expect(group.keys.scope!.group).toEqual({ id: groupId, name: `Analytics Fam ${suffix}` });

    // Fan-out: bucket sum exceeds the unique total by exactly T5.
    expect(personal.spendCents + group.spendCents).toBe(JUNE_USD_TOTAL + 5000);
  });

  it('a narrowing scope filter stays count-once', async () => {
    const res = await runQuery(alice.accessToken, {
      dimensions: [],
      filters: { ...JUNE, scopes: [{ scope: 'group', groupId }] },
    });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].spendCents).toBe(25000);
    expect(res.body.data[0].transactionCount).toBe(2);
  });

  it("orders the user's default currency first regardless of alphabet", async () => {
    // EUR < USD alphabetically; Alice's default is USD → USD must lead.
    const res = await runQuery(alice.accessToken, {
      dimensions: [],
      filters: { ...JUNE },
      sort: { by: 'key', dir: 'asc' },
    });
    expect(res.body.data.map((r) => r.currency)).toEqual(['USD', 'EUR']);
  });

  it('buckets by period (month) across the full history', async () => {
    const res = await runQuery(alice.accessToken, {
      dimensions: ['period'],
      granularity: 'month',
      filters: { currencies: ['USD'] },
      sort: { by: 'key', dir: 'asc' },
    });
    const may = res.body.data.find((r) => r.keys.period === '2026-05')!;
    const june = res.body.data.find((r) => r.keys.period === '2026-06')!;
    expect(may.spendCents).toBe(6000);
    expect(june.spendCents).toBe(JUNE_USD_TOTAL);
    expect(res.body.data.indexOf(may)).toBeLessThan(res.body.data.indexOf(june));
  });

  it('supports direction IN at header grain', async () => {
    const res = await runQuery(alice.accessToken, {
      dimensions: [],
      filters: { ...JUNE, direction: 'IN' },
    });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].spendCents).toBe(500000);
    expect(res.body.data[0].itemCount).toBe(0);
  });

  it('paginates grouped rows with a fingerprinted cursor', async () => {
    const query = {
      dimensions: ['category'],
      filters: { ...JUNE, currencies: ['USD'] },
      limit: 2,
    };
    const page1 = await runQuery(alice.accessToken, query);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.data.map((r) => r.spendCents)).toEqual([407700, 64000]); // spend desc

    const page2 = await runQuery(alice.accessToken, { ...query, cursor: page1.body.cursor });
    expect(page2.body.data.map((r) => r.spendCents)).toEqual([5000, 1000]);
    expect(page2.body.hasMore).toBe(false);
    expect(page2.body.cursor).toBeNull();

    // The same cursor with different filters is rejected.
    const mismatched = await runQuery(alice.accessToken, {
      ...query,
      filters: { ...JUNE, currencies: ['EUR'] },
      cursor: page1.body.cursor,
    });
    expect(mismatched.status).toBe(400);
    expect(mismatched.body.errorCode).toBe('ANALYTICS_INVALID_CURSOR');
  });

  it('403s a scope filter naming a non-member group', async () => {
    const res = await runQuery(alice.accessToken, {
      dimensions: [],
      filters: { scopes: [{ scope: 'group', groupId: carolGroupId }] },
    });
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('ANALYTICS_SCOPE_FORBIDDEN');
  });

  it('enforces visibility per caller', async () => {
    const carolRes = await runQuery(carol.accessToken, { dimensions: [], filters: { ...JUNE } });
    expect(carolRes.body.data).toHaveLength(1);
    expect(carolRes.body.data[0].spendCents).toBe(99900);

    const bobRes = await runQuery(bob.accessToken, { dimensions: [], filters: { ...JUNE } });
    expect(bobRes.body.data).toHaveLength(1);
    expect(bobRes.body.data[0].spendCents).toBe(25000); // T4 + T5 via the group
    expect(bobRes.body.data[0].transactionCount).toBe(2);
  });

  it('rejects semantically invalid queries', async () => {
    const noGranularity = await runQuery(alice.accessToken, { dimensions: ['period'] });
    expect(noGranularity.status).toBe(400);
    expect(noGranularity.body.errorCode).toBe('ANALYTICS_INVALID_QUERY');

    const scopeAndGroup = await runQuery(alice.accessToken, { dimensions: ['scope', 'group'] });
    expect(scopeAndGroup.status).toBe(400);

    const threeDims = await runQuery(alice.accessToken, {
      dimensions: ['category', 'merchant', 'product'],
    });
    expect(threeDims.status).toBe(400); // DTO ArrayMaxSize

    const unknownDim = await runQuery(alice.accessToken, { dimensions: ['weather'] });
    expect(unknownDim.status).toBe(400); // DTO IsIn
  });
});
