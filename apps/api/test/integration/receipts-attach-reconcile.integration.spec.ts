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
 * Phase 8.15 — attach a receipt to an existing payment + reconcile.
 *
 * Exercises `POST /payments/:id/receipt(-url)` (receipt born linked to the
 * payment) and `POST /receipts/:id/reconcile` (REVIEW → CONFIRMED without a
 * new payment, applying the receipt's total/category to the payment per the
 * flags). Receipts are pushed to REVIEW via Prisma — the async worker is out
 * of scope here.
 */
describe('attach receipt to payment + reconcile (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let paymentQueue: Queue;
  let receiptQueue: Queue;
  let redis: StartedTestContainer;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let groceriesId: string;
  let diningId: string;

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
    alice = await registerUser(app, `ra-a-${suffix}@test.local`);
    bob = await registerUser(app, `ra-b-${suffix}@test.local`);

    const groceries = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    });
    const dining = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: { not: 'groceries' } },
    });
    groceriesId = groceries!.id;
    diningId = dining!.id;
  }, 120_000);

  afterAll(async () => {
    if (paymentQueue) await paymentQueue.close().catch(() => undefined);
    if (receiptQueue) await receiptQueue.close().catch(() => undefined);
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
    await prisma.paymentAttribution.deleteMany({});
    await prisma.payment.deleteMany({
      where: { createdById: { in: [alice.user.id, bob.user.id] } },
    });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [alice.user.id, bob.user.id] } } });
  });

  /** Create an OUT ONE_TIME payment via the API and return its id. */
  async function createPayment(token: string, over: Record<string, unknown> = {}): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set(auth(token))
      .send({
        direction: 'OUT',
        type: 'ONE_TIME',
        amountCents: 1000,
        currency: 'USD',
        occurredAt: '2026-07-01T12:00:00.000Z',
        categoryId: groceriesId,
        attributions: [{ scope: 'personal' }],
        ...over,
      })
      .expect(201);
    return res.body.id as string;
  }

  it('1. attaches a URL receipt to a payment (born linked)', async () => {
    const paymentId = await createPayment(alice.accessToken);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentId}/receipt-url`)
      .set(auth(alice.accessToken))
      .send({ url: 'https://receipts.example.com/r/1' })
      .expect(201);

    expect(res.body.paymentId).toBe(paymentId);
    expect(res.body.source).toBe('url');
    expect(res.body.status).toBe('UPLOADED');
  });

  it("2. 404s attaching to another user's payment (no existence leak)", async () => {
    const paymentId = await createPayment(bob.accessToken);
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentId}/receipt-url`)
      .set(auth(alice.accessToken))
      .send({ url: 'https://receipts.example.com/r/1' })
      .expect(404);
  });

  it('3. rejects a second receipt on the same payment', async () => {
    const paymentId = await createPayment(alice.accessToken);
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentId}/receipt-url`)
      .set(auth(alice.accessToken))
      .send({ url: 'https://receipts.example.com/r/1' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentId}/receipt-url`)
      .set(auth(alice.accessToken))
      .send({ url: 'https://receipts.example.com/r/2' })
      .expect(400);
  });

  it('4. reconcile applies the total and dominant category to the payment', async () => {
    const paymentId = await createPayment(alice.accessToken, {
      amountCents: 1000,
      categoryId: groceriesId,
    });
    // Attach + push straight to REVIEW with a richer total and a dining-heavy
    // basket (dominant category = dining).
    const receipt = await prisma.receipt.create({
      data: {
        status: 'REVIEW',
        source: 'url',
        sourceUrl: 'https://receipts.example.com/r/1',
        currency: 'USD',
        totalCents: 4200,
        uploadedById: alice.user.id,
        paymentId,
        items: {
          create: [
            { position: 1, rawName: 'Dinner', quantity: 1, totalCents: 3000, categoryId: diningId },
            {
              position: 2,
              rawName: 'Snack',
              quantity: 1,
              totalCents: 1200,
              categoryId: groceriesId,
            },
          ],
        },
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receipt.id}/reconcile`)
      .set(auth(alice.accessToken))
      .send({ applyTotal: true, applyCategory: true })
      .expect(201);

    expect(res.body.status).toBe('CONFIRMED');
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(payment).toMatchObject({ amountCents: 4200, currency: 'USD', categoryId: diningId });
  });

  it('5. reconcile with both flags false confirms without touching the payment', async () => {
    const paymentId = await createPayment(alice.accessToken, {
      amountCents: 1000,
      categoryId: groceriesId,
    });
    const receipt = await prisma.receipt.create({
      data: {
        status: 'REVIEW',
        source: 'url',
        sourceUrl: 'https://receipts.example.com/r/1',
        currency: 'EUR',
        totalCents: 9999,
        uploadedById: alice.user.id,
        paymentId,
        items: {
          create: [
            { position: 1, rawName: 'X', quantity: 1, totalCents: 9999, categoryId: diningId },
          ],
        },
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receipt.id}/reconcile`)
      .set(auth(alice.accessToken))
      .send({ applyTotal: false, applyCategory: false })
      .expect(201);

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(payment).toMatchObject({ amountCents: 1000, currency: 'USD', categoryId: groceriesId });
  });

  it('6. an attached receipt cannot be confirmed (must reconcile)', async () => {
    const paymentId = await createPayment(alice.accessToken);
    const receipt = await prisma.receipt.create({
      data: {
        status: 'REVIEW',
        source: 'url',
        sourceUrl: 'https://receipts.example.com/r/1',
        currency: 'USD',
        totalCents: 2000,
        uploadedById: alice.user.id,
        paymentId,
        items: { create: [] },
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receipt.id}/confirm`)
      .set(auth(alice.accessToken))
      .send({ categoryId: groceriesId, attributions: [{ scope: 'personal' }] })
      .expect(400);
  });
});
