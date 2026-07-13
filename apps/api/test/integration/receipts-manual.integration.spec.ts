import { normalizeLookupName } from '@myfinpro/shared';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { seedSystemCategories } from '../../src/payment/seed-system-categories';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  PAYMENT_OCCURRENCES_QUEUE,
  RECEIPT_EXTRACTIONS_QUEUE,
} from '../../src/queue/queue.constants';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 8.14 — POST /receipts/manual integration tests.
 *
 * A receipt composed by scanning products: no extraction job runs, the
 * receipt is born in REVIEW with items pre-linked to their registry
 * products, and confirm turns it into a payment like any other receipt.
 */
describe('POST /receipts/manual (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let paymentQueue: Queue;
  let receiptQueue: Queue;
  let redis: StartedTestContainer;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let outCategoryId: string;
  let milkId: string;
  let breadId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const originalEnv = {
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS_TLS: process.env.REDIS_TLS,
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    redis = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withCommand(['redis-server', '--appendonly', 'no'])
      .start();
    process.env.REDIS_HOST = redis.getHost();
    process.env.REDIS_PORT = String(redis.getMappedPort(6379));
    process.env.REDIS_PASSWORD = '';
    process.env.REDIS_TLS = 'false';

    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    paymentQueue = app.get(getQueueToken(PAYMENT_OCCURRENCES_QUEUE));
    receiptQueue = app.get(getQueueToken(RECEIPT_EXTRACTIONS_QUEUE));

    await seedSystemCategories(prisma);
    alice = await registerUser(app, `rm-a-${suffix}@test.local`);

    const outCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    });
    outCategoryId = outCat!.id;

    const milk = await prisma.product.create({
      data: {
        name: 'Manual Milk 3%',
        normalizedName: normalizeLookupName('Manual Milk 3%'),
        brand: 'Tnuva',
        defaultCategoryId: outCategoryId,
      },
    });
    const bread = await prisma.product.create({
      data: { name: 'Manual Bread', normalizedName: normalizeLookupName('Manual Bread') },
    });
    milkId = milk.id;
    breadId = bread.id;
  }, 120_000);

  afterAll(async () => {
    if (paymentQueue) await paymentQueue.close().catch(() => undefined);
    if (receiptQueue) await receiptQueue.close().catch(() => undefined);
    await prisma.product.deleteMany({ where: { id: { in: [milkId, breadId] } } });
    if (app) await app.close();
    if (redis) await redis.stop();
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 30_000);

  afterEach(async () => {
    await prisma.receipt.deleteMany({ where: { uploadedById: alice.user.id } });
    await prisma.paymentAttribution.deleteMany({});
    await prisma.payment.deleteMany({ where: { createdById: alice.user.id } });
    await prisma.auditLog.deleteMany({ where: { userId: alice.user.id } });
  });

  it('1. creates a REVIEW receipt with pre-linked barcode-confirmed items', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/receipts/manual')
      .set(auth(alice.accessToken))
      .send({
        currency: 'ils',
        merchantName: 'Corner Shop',
        items: [
          { productId: milkId, quantity: 2, unitPriceCents: 750 },
          { productId: breadId, quantity: 1, unitPriceCents: 600 },
        ],
      })
      .expect(201);

    expect(res.body.status).toBe('REVIEW');
    expect(res.body.source).toBe('manual');
    expect(res.body.currency).toBe('ILS');
    expect(res.body.totalCents).toBe(2100);
    expect(res.body.extractedMerchantName).toBe('Corner Shop');
    expect(res.body.items).toHaveLength(2);

    const milkLine = res.body.items.find((i: { productId: string }) => i.productId === milkId);
    expect(milkLine).toMatchObject({
      productId: milkId,
      matchStatus: 'CONFIRMED',
      unitPriceCents: 750,
      totalCents: 1500,
      categoryId: outCategoryId,
      rawName: 'Manual Milk 3%',
    });
    // No extraction job was enqueued for a manual receipt.
    const jobs = await receiptQueue.getJobs(['waiting', 'active', 'delayed', 'completed']);
    expect(jobs.every((j) => j.data?.receiptId !== res.body.id)).toBe(true);
  });

  it('2. rejects an unknown product id with 404', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/receipts/manual')
      .set(auth(alice.accessToken))
      .send({
        currency: 'USD',
        items: [
          { productId: '00000000-0000-0000-0000-000000000000', quantity: 1, unitPriceCents: 100 },
        ],
      })
      .expect(404);
  });

  it('3. rejects an empty item list (≥1 required)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/receipts/manual')
      .set(auth(alice.accessToken))
      .send({ currency: 'USD', items: [] })
      .expect(400);
  });

  it('4. rejects retry-extraction on a manual receipt', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/receipts/manual')
      .set(auth(alice.accessToken))
      .send({ currency: 'USD', items: [{ productId: milkId, quantity: 1, unitPriceCents: 500 }] })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/receipts/${created.body.id}/retry`)
      .set(auth(alice.accessToken))
      .expect(400);
  });

  it('5. confirm turns the manual receipt into a payment', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/receipts/manual')
      .set(auth(alice.accessToken))
      .send({
        currency: 'USD',
        items: [{ productId: milkId, quantity: 3, unitPriceCents: 500 }],
      })
      .expect(201);

    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/receipts/${created.body.id}/confirm`)
      .set(auth(alice.accessToken))
      .send({ categoryId: outCategoryId, attributions: [{ scope: 'personal' }] })
      .expect(201);

    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(confirmed.body.paymentId).toBeTruthy();

    const payment = await prisma.payment.findUnique({ where: { id: confirmed.body.paymentId } });
    expect(payment).toMatchObject({ amountCents: 1500, currency: 'USD', direction: 'OUT' });
  });
});
