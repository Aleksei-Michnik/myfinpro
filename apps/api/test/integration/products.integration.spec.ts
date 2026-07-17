import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PRODUCT_IMAGES_QUEUE, RECEIPT_EXTRACTIONS_QUEUE } from '../../src/queue/queue.constants';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 8 — product registry + walkthrough integration tests.
 *
 * Exercises the two-layer design end-to-end against the real AppModule:
 * global registry CRUD/search/aliases/barcode (8.2), walkthrough match →
 * alias auto-update (8.4/8.5), and the caller-scoped privacy boundary of
 * purchase data (design §1.1). OFF is disabled via env so nothing leaves
 * the test network; receipts are seeded straight to REVIEW/CONFIRMED (the
 * async worker is covered by unit tests).
 */
describe('Products & walkthrough (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let receiptQueue: Queue;
  let imageQueue: Queue;
  let redis: StartedTestContainer;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let outCategoryId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const pname = (base: string) => `${base} ${suffix}`;

  const originalEnv = {
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS_TLS: process.env.REDIS_TLS,
    OFF_ENABLED: process.env.OFF_ENABLED,
  };

  beforeAll(async () => {
    redis = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withCommand(['redis-server', '--appendonly', 'no'])
      .start();
    process.env.REDIS_HOST = redis.getHost();
    process.env.REDIS_PORT = String(redis.getMappedPort(6379));
    process.env.REDIS_PASSWORD = '';
    process.env.REDIS_TLS = 'false';
    process.env.OFF_ENABLED = 'false'; // no external calls from tests

    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    receiptQueue = app.get(getQueueToken(RECEIPT_EXTRACTIONS_QUEUE));
    imageQueue = app.get(getQueueToken(PRODUCT_IMAGES_QUEUE));

    await seedSystemCategories(prisma);
    alice = await registerUser(app, `pr-a-${suffix}@test.local`);
    bob = await registerUser(app, `pr-b-${suffix}@test.local`);

    const outCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    });
    outCategoryId = outCat!.id;
  }, 120_000);

  afterAll(async () => {
    if (receiptQueue) await receiptQueue.close().catch(() => undefined);
    if (imageQueue) await imageQueue.close().catch(() => undefined);
    if (app) await app.close();
    if (redis) await redis.stop();
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 30_000);

  afterEach(async () => {
    await prisma.receipt.deleteMany({
      where: { uploadedById: { in: [alice.user.id, bob.user.id] } },
    });
    await prisma.product.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [alice.user.id, bob.user.id] } } });
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Seed a receipt in the given status with one unmatched line item. */
  async function seedReceipt(
    uploadedById: string,
    status: 'REVIEW' | 'CONFIRMED',
    itemName: string,
    over: Record<string, unknown> = {},
  ): Promise<{ receiptId: string; itemId: string }> {
    const row = await prisma.receipt.create({
      data: {
        status,
        source: 'upload',
        files: {
          create: [
            {
              position: 1,
              fileRef: `test/${suffix}-${Math.random().toString(36).slice(2, 8)}.jpg`,
              mimeType: 'image/jpeg',
              sizeBytes: 2048,
            },
          ],
        },
        currency: 'ILS',
        totalCents: 880,
        purchasedAt: new Date('2026-07-01T12:00:00.000Z'),
        uploadedById,
        items: {
          create: [
            {
              position: 1,
              rawName: itemName,
              quantity: 2,
              unitPriceCents: 440,
              totalCents: 880,
              purchasedAt: new Date('2026-07-01T12:00:00.000Z'),
            },
          ],
        },
        ...over,
      },
      include: { items: true },
    });
    return { receiptId: row.id, itemId: row.items[0].id };
  }

  it('1. registry create → checksum + uniqueness + seeded alias + audit', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(auth(alice.accessToken))
      .send({
        name: pname('Milk 3%'),
        brand: 'Tnuva',
        barcode: '7290000066318',
        defaultCategoryId: outCategoryId,
        aliasLocale: 'en',
      })
      .expect(201);
    expect(res.body).toMatchObject({ barcode: '7290000066318', brand: 'Tnuva' });

    // Canonical name doubles as the first alias.
    const aliases = await prisma.productAlias.findMany({ where: { productId: res.body.id } });
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({ source: 'manual', locale: 'en', confirmationCount: 1 });

    // Duplicate barcode → structured 400.
    const dup = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(auth(alice.accessToken))
      .send({ name: pname('Other'), barcode: '7290000066318' })
      .expect(400);
    expect(dup.body.errorCode).toBe('PRODUCT_BARCODE_TAKEN');

    // Bad checksum → structured 400.
    const bad = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(auth(alice.accessToken))
      .send({ name: pname('Bad'), barcode: '7290000066317' })
      .expect(400);
    expect(bad.body.errorCode).toBe('PRODUCT_INVALID_BARCODE');

    const audit = await prisma.auditLog.findFirst({
      where: { userId: alice.user.id, action: 'PRODUCT_CREATED' },
    });
    expect(audit).toBeTruthy();
  });

  it('2. registry search finds partial names and cross-language aliases; barcode resolves', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(auth(alice.accessToken))
      .send({ name: pname('Cottage Cheese'), barcode: '96385074' })
      .expect(201);

    // Hebrew alias added by another user — the registry is global.
    await request(app.getHttpServer())
      .post(`/api/v1/products/${created.body.id}/aliases`)
      .set(auth(bob.accessToken))
      .send({ name: `קוטג ${suffix}`, locale: 'he' })
      .expect(201);

    // Partial English search.
    const en = await request(app.getHttpServer())
      .get('/api/v1/products')
      .query({ search: 'cottage chees' })
      .set(auth(bob.accessToken))
      .expect(200);
    expect(en.body.data.some((p: { id: string }) => p.id === created.body.id)).toBe(true);

    // Hebrew alias search.
    const he = await request(app.getHttpServer())
      .get('/api/v1/products')
      .query({ search: `קוטג ${suffix}` })
      .set(auth(alice.accessToken))
      .expect(200);
    expect(he.body.data.some((p: { id: string }) => p.id === created.body.id)).toBe(true);

    // Barcode lookup — local registry hit, OFF untouched (disabled).
    const bc = await request(app.getHttpServer())
      .get('/api/v1/products/barcode/96385074')
      .set(auth(alice.accessToken))
      .expect(200);
    expect(bc.body).toMatchObject({ found: true, offStatus: 'registry' });
    expect(bc.body.product.id).toBe(created.body.id);

    // Unknown barcode with OFF disabled degrades to manual entry.
    const miss = await request(app.getHttpServer())
      .get('/api/v1/products/barcode/4006381333931')
      .set(auth(alice.accessToken))
      .expect(200);
    expect(miss.body).toMatchObject({ found: false, offStatus: 'disabled' });
  });

  it('3. walkthrough: create-and-link → CONFIRMED item + confirmation alias; skip stays resumable', async () => {
    const { receiptId, itemId } = await seedReceipt(alice.user.id, 'REVIEW', `חלב 3% ${suffix}`);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/items/${itemId}/match`)
      .set(auth(alice.accessToken))
      .send({ createProduct: { name: pname('Milk 3% walkthrough') }, categoryId: outCategoryId })
      .expect(201);

    const item = res.body.items[0];
    expect(item).toMatchObject({
      matchStatus: 'CONFIRMED',
      categoryId: outCategoryId,
      productName: pname('Milk 3% walkthrough'),
    });

    // Registry auto-update (8.5): the raw Hebrew spelling became an alias
    // with the confirmer's locale.
    const alias = await prisma.productAlias.findFirst({
      where: { productId: item.productId, name: `חלב 3% ${suffix}` },
    });
    expect(alias).toBeTruthy();
    expect(alias!.source).toBe('confirmation');

    // Skip → SKIPPED and the link is cleared (resumable).
    const skipped = await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/items/${itemId}/skip-match`)
      .set(auth(alice.accessToken))
      .expect(201);
    expect(skipped.body.items[0]).toMatchObject({ matchStatus: 'SKIPPED', productId: null });

    // Re-confirming the same spelling bumps the alias counter.
    await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/items/${itemId}/match`)
      .set(auth(alice.accessToken))
      .send({ productId: item.productId })
      .expect(201);
    const bumped = await prisma.productAlias.findFirst({
      where: { productId: item.productId, name: `חלב 3% ${suffix}` },
    });
    expect(bumped!.confirmationCount).toBe(2);
  });

  it('4. walkthrough guards: XOR body, foreign receipts 404, UPLOADED receipts 400', async () => {
    const { receiptId, itemId } = await seedReceipt(alice.user.id, 'REVIEW', `Bread ${suffix}`);

    const both = await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/items/${itemId}/match`)
      .set(auth(alice.accessToken))
      .send({})
      .expect(400);
    expect(both.body.errorCode).toBe('PRODUCT_MATCH_INVALID');

    await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/items/${itemId}/match`)
      .set(auth(bob.accessToken))
      .send({ createProduct: { name: pname('Nope') } })
      .expect(404);

    const uploaded = await seedReceipt(alice.user.id, 'REVIEW', `Eggs ${suffix}`, {
      status: 'UPLOADED',
    });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/receipts/${uploaded.receiptId}/items/${uploaded.itemId}/match`)
      .set(auth(alice.accessToken))
      .send({ createProduct: { name: pname('Nope2') } })
      .expect(400);
    expect(res.body.errorCode).toBe('RECEIPT_INVALID_STATE');
  });

  it('5. purchase data stays private: my-products list + purchases are caller-scoped', async () => {
    // Alice confirms a purchase of a shared registry product.
    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(auth(alice.accessToken))
      .send({ name: pname('Shared Yogurt') })
      .expect(201);
    const { receiptId, itemId } = await seedReceipt(alice.user.id, 'CONFIRMED', `Yogurt ${suffix}`);
    await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/items/${itemId}/match`)
      .set(auth(alice.accessToken))
      .send({ productId: product.body.id })
      .expect(201);

    // Alice sees the product in "my products" with stats.
    const mineA = await request(app.getHttpServer())
      .get('/api/v1/products')
      .set(auth(alice.accessToken))
      .expect(200);
    const rowA = mineA.body.data.find((p: { id: string }) => p.id === product.body.id);
    expect(rowA).toBeTruthy();
    expect(rowA.stats).toMatchObject({ timesPurchased: 1, lastUnitPriceCents: 440 });

    // Bob does not — the registry row exists, his purchase layer is empty.
    const mineB = await request(app.getHttpServer())
      .get('/api/v1/products')
      .set(auth(bob.accessToken))
      .expect(200);
    expect(mineB.body.data.some((p: { id: string }) => p.id === product.body.id)).toBe(false);

    const purchasesB = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.body.id}/purchases`)
      .set(auth(bob.accessToken))
      .expect(200);
    expect(purchasesB.body.purchases).toHaveLength(0);

    const purchasesA = await request(app.getHttpServer())
      .get(`/api/v1/products/${product.body.id}/purchases`)
      .set(auth(alice.accessToken))
      .expect(200);
    expect(purchasesA.body.purchases).toHaveLength(1);
    expect(purchasesA.body.purchases[0]).toMatchObject({ unitPriceCents: 440, currency: 'ILS' });
  });

  it('6. registry update: rename re-normalizes; private default categories are rejected', async () => {
    const product = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(auth(alice.accessToken))
      .send({ name: pname('Rename Me') })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/products/${product.body.id}`)
      .set(auth(bob.accessToken)) // global registry — any user may curate
      .send({ name: pname('Renamed') })
      .expect(200);
    const row = await prisma.product.findUnique({ where: { id: product.body.id } });
    expect(row!.normalizedName).toBe(pname('Renamed').toLowerCase());

    // A personal category can never become a global default.
    const personal = await prisma.category.create({
      data: {
        slug: `personal-${suffix}`,
        name: `Personal ${suffix}`,
        direction: 'OUT',
        ownerType: 'user',
        ownerId: bob.user.id,
      },
    });
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/products/${product.body.id}`)
      .set(auth(bob.accessToken))
      .send({ defaultCategoryId: personal.id })
      .expect(400);
    expect(res.body.errorCode).toBe('PRODUCT_INVALID_CATEGORY');
    await prisma.category.delete({ where: { id: personal.id } });
  });
});
