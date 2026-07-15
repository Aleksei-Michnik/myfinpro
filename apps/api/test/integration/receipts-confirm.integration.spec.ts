import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  TRANSACTION_OCCURRENCES_QUEUE,
  RECEIPT_EXTRACTIONS_QUEUE,
} from '../../src/queue/queue.constants';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 7.9 — POST /receipts/:id/confirm integration tests.
 *
 * Bootstraps the real AppModule against the test DB/Redis and exercises
 * confirmation end-to-end: a reviewed receipt becomes one OUT / ONE_TIME
 * transaction with a receipt document, the merchant lands in the global
 * registry, the receipt is linked + marked CONFIRMED, and the transaction shows
 * up in the owner's list. Receipts are seeded straight to REVIEW via Prisma
 * (the async extraction worker is out of scope here).
 */
describe('POST /receipts/:id/confirm (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let transactionQueue: Queue;
  let receiptQueue: Queue;
  let redis: StartedTestContainer;

  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let outCategoryId: string;
  let inCategoryId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

  const originalEnv = {
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS_TLS: process.env.REDIS_TLS,
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

    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    transactionQueue = app.get(getQueueToken(TRANSACTION_OCCURRENCES_QUEUE));
    receiptQueue = app.get(getQueueToken(RECEIPT_EXTRACTIONS_QUEUE));

    await seedSystemCategories(prisma);

    alice = await registerUser(app, `rc-a-${suffix}@test.local`);
    bob = await registerUser(app, `rc-b-${suffix}@test.local`);

    const outCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    });
    const inCat = await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'IN' },
    });
    outCategoryId = outCat!.id;
    inCategoryId = inCat!.id;
  }, 120_000);

  afterAll(async () => {
    if (transactionQueue) await transactionQueue.close().catch(() => undefined);
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
    await prisma.transactionAttribution.deleteMany({});
    await prisma.transaction.deleteMany({
      where: { createdById: { in: [alice.user.id, bob.user.id] } },
    });
    await prisma.merchant.deleteMany({ where: { normalizedName: { contains: 'confirmco' } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [alice.user.id, bob.user.id] } } });
  });

  /** Seed a receipt straight to REVIEW with the money fields + a line item. */
  async function seedReviewReceipt(
    uploadedById: string,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const row = await prisma.receipt.create({
      data: {
        status: 'REVIEW',
        source: 'upload',
        fileRef: `test/${suffix}-${Math.random().toString(36).slice(2, 8)}.jpg`,
        originalName: 'receipt.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2048,
        extractedMerchantName: 'ConfirmCo Market',
        currency: 'USD',
        totalCents: 2599,
        purchasedAt: new Date('2026-07-01T12:00:00.000Z'),
        uploadedById,
        items: {
          create: [
            {
              position: 1,
              rawName: 'Milk',
              quantity: 2,
              totalCents: 1000,
              categoryId: outCategoryId,
            },
            { position: 2, rawName: 'Bread', quantity: 1, totalCents: 1599 },
          ],
        },
        ...over,
      },
    });
    return row.id;
  }

  it('1. confirms a reviewed receipt → transaction + document + merchant + link', async () => {
    const receiptId = await seedReviewReceipt(alice.user.id);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/confirm`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ categoryId: outCategoryId, attributions: [{ scope: 'personal' }] })
      .expect(201);

    expect(res.body.status).toBe('CONFIRMED');
    expect(res.body.transactionId).toBeTruthy();
    const transactionId = res.body.transactionId as string;

    // Transaction: OUT / ONE_TIME with the receipt's money fields + document.
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { attributions: true, documents: true },
    });
    expect(transaction).toMatchObject({
      direction: 'OUT',
      type: 'ONE_TIME',
      amountCents: 2599,
      currency: 'USD',
      categoryId: outCategoryId,
      createdById: alice.user.id,
    });
    expect(transaction!.attributions).toHaveLength(1);
    expect(transaction!.attributions[0]).toMatchObject({
      scopeType: 'personal',
      userId: alice.user.id,
    });
    expect(transaction!.documents).toHaveLength(1);
    expect(transaction!.documents[0]).toMatchObject({
      kind: 'receipt',
      uploadedById: alice.user.id,
    });

    // Merchant registered + linked; receipt links back to the transaction.
    const merchant = await prisma.merchant.findUnique({
      where: { normalizedName: 'confirmco market' },
    });
    expect(merchant).toBeTruthy();
    const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
    expect(receipt).toMatchObject({
      status: 'CONFIRMED',
      transactionId,
      merchantId: merchant!.id,
    });

    // Audit trail.
    const audits = await prisma.auditLog.findMany({
      where: { userId: alice.user.id, action: { in: ['RECEIPT_CONFIRMED', 'MERCHANT_CREATED'] } },
    });
    expect(audits.map((a) => a.action).sort()).toEqual(['MERCHANT_CREATED', 'RECEIPT_CONFIRMED']);

    // The transaction shows up in the owner's list.
    const list = await request(app.getHttpServer())
      .get('/api/v1/transactions')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(list.body.data.some((p: { id: string }) => p.id === transactionId)).toBe(true);
  });

  it('2. reuses an existing registry merchant instead of creating a duplicate', async () => {
    const existing = await prisma.merchant.create({
      data: { name: 'ConfirmCo Market', normalizedName: 'confirmco market' },
    });
    const receiptId = await seedReviewReceipt(alice.user.id);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/confirm`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ categoryId: outCategoryId, attributions: [{ scope: 'personal' }] })
      .expect(201);

    const receipt = await prisma.receipt.findUnique({ where: { id: res.body.id } });
    expect(receipt!.merchantId).toBe(existing.id);
    const count = await prisma.merchant.count({ where: { normalizedName: 'confirmco market' } });
    expect(count).toBe(1);
    const created = await prisma.auditLog.findFirst({
      where: { userId: alice.user.id, action: 'MERCHANT_CREATED' },
    });
    expect(created).toBeNull();
  });

  it('3. rejects a second confirmation (REVIEW-only)', async () => {
    const receiptId = await seedReviewReceipt(alice.user.id);
    await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/confirm`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ categoryId: outCategoryId, attributions: [{ scope: 'personal' }] })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/confirm`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ categoryId: outCategoryId, attributions: [{ scope: 'personal' }] })
      .expect(400);
    expect(res.body.errorCode).toBe('RECEIPT_INVALID_STATE');
  });

  it('4. rejects confirmation without a total', async () => {
    const receiptId = await seedReviewReceipt(alice.user.id, { totalCents: null });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/confirm`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ categoryId: outCategoryId, attributions: [{ scope: 'personal' }] })
      .expect(400);
    expect(res.body.errorCode).toBe('RECEIPT_INVALID_STATE');
  });

  it('5. rejects an IN category (direction mismatch)', async () => {
    const receiptId = await seedReviewReceipt(alice.user.id);
    await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/confirm`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ categoryId: inCategoryId, attributions: [{ scope: 'personal' }] })
      .expect(400);
    // Receipt stays REVIEW — nothing was written.
    const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
    expect(receipt!.status).toBe('REVIEW');
    expect(receipt!.transactionId).toBeNull();
  });

  it("6. a non-uploader cannot confirm someone else's receipt (404)", async () => {
    const receiptId = await seedReviewReceipt(alice.user.id);
    await request(app.getHttpServer())
      .post(`/api/v1/receipts/${receiptId}/confirm`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .send({ categoryId: outCategoryId, attributions: [{ scope: 'personal' }] })
      .expect(404);
  });
});
