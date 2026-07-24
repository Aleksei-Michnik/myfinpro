import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OFF_MIN_CALL_INTERVAL_MS } from '../../src/product/open-food-facts.service';
import { ProductEnrichmentService } from '../../src/product/product-enrichment.service';
import { PRODUCT_IMAGES_QUEUE, RECEIPT_EXTRACTIONS_QUEUE } from '../../src/queue/queue.constants';
import { bootstrapTestApp, registerUser } from './helpers';

/** Valid GTIN-13 from a unique 12-digit base — re-runs never collide. */
function uniqueGtin13(seed: number): string {
  const base = `2${String(seed).slice(-11).padStart(11, '0')}`;
  const sum = [...base].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return base + String((10 - (sum % 10)) % 10);
}

/**
 * Phase 8 — barcode auto-import from Open Food Facts (design §1.4).
 *
 * Boots the real AppModule against a local stub standing in for the OFF
 * API (nothing leaves the test network) and exercises the full scan path:
 * unknown code + ?import=true → registry row minted with an 'off' alias →
 * the very next lookup is a plain registry hit. Without the flag the same
 * kind of hit stays a create-form prefill and mints nothing.
 */
describe('OFF auto-import (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let receiptQueue: Queue;
  let imageQueue: Queue;
  let redis: StartedTestContainer;
  let offStub: Server;

  let alice: Awaited<ReturnType<typeof registerUser>>;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const importCode = uniqueGtin13(Date.now());
  const prefillCode = uniqueGtin13(Date.now() + 1);
  const enrichCode = uniqueGtin13(Date.now() + 2);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const originalEnv = {
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS_TLS: process.env.REDIS_TLS,
    OFF_ENABLED: process.env.OFF_ENABLED,
    OFF_BASE_URL: process.env.OFF_BASE_URL,
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

    // OFF-shaped stub: every product is known, named, and imageless (no
    // image keeps the images queue out of this suite).
    offStub = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          status: 1,
          product: { product_name: `Stub Nutella ${suffix}`, brands: 'Ferrero,Other' },
        }),
      );
    });
    await new Promise<void>((resolve) => offStub.listen(0, '127.0.0.1', resolve));
    process.env.OFF_ENABLED = 'true';
    process.env.OFF_BASE_URL = `http://127.0.0.1:${(offStub.address() as AddressInfo).port}`;

    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    receiptQueue = app.get(getQueueToken(RECEIPT_EXTRACTIONS_QUEUE));
    imageQueue = app.get(getQueueToken(PRODUCT_IMAGES_QUEUE));

    alice = await registerUser(app, `off-${suffix}@test.local`);
  }, 120_000);

  afterAll(async () => {
    if (receiptQueue) await receiptQueue.close().catch(() => undefined);
    if (imageQueue) await imageQueue.close().catch(() => undefined);
    if (app) await app.close();
    if (offStub) await new Promise((resolve) => offStub.close(resolve));
    if (redis) await redis.stop();
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 30_000);

  it('?import=true publishes the OFF hit to the registry; the next lookup is a registry hit', async () => {
    const imported = await request(app.getHttpServer())
      .get(`/api/v1/products/barcode/${importCode}`)
      .query({ import: true })
      .set(auth(alice.accessToken))
      .expect(200);
    expect(imported.body).toMatchObject({ found: true, offStatus: 'imported' });
    expect(imported.body.product).toMatchObject({
      name: `Stub Nutella ${suffix}`,
      brand: 'Ferrero', // first entry of OFF's comma-separated brands
      barcode: importCode,
    });

    // The row exists globally with OFF provenance on its seeded alias.
    const row = await prisma.product.findUnique({
      where: { barcode: importCode },
      include: { aliases: true },
    });
    expect(row).not.toBeNull();
    expect(row!.aliases).toHaveLength(1);
    expect(row!.aliases[0]).toMatchObject({ source: 'off', name: `Stub Nutella ${suffix}` });

    // Idempotent: the same scan now resolves locally, no second row.
    const again = await request(app.getHttpServer())
      .get(`/api/v1/products/barcode/${importCode}`)
      .query({ import: true })
      .set(auth(alice.accessToken))
      .expect(200);
    expect(again.body).toMatchObject({ found: true, offStatus: 'registry' });
    expect(again.body.product.id).toBe(imported.body.product.id);
  });

  it('without ?import the same kind of hit stays a prefill and mints no row', async () => {
    // Respect the OFF client's one-call-per-second etiquette throttle.
    await new Promise((resolve) => setTimeout(resolve, OFF_MIN_CALL_INTERVAL_MS + 100));

    const res = await request(app.getHttpServer())
      .get(`/api/v1/products/barcode/${prefillCode}`)
      .set(auth(alice.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({
      found: false,
      offStatus: 'off',
      prefill: { name: `Stub Nutella ${suffix}`, brand: 'Ferrero' },
    });
    expect(await prisma.product.findUnique({ where: { barcode: prefillCode } })).toBeNull();
  });

  it('the nightly enrichment sweep fills a never-checked product from OFF', async () => {
    // A manually created product carries a barcode the checker never saw.
    const created = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set(auth(alice.accessToken))
      .send({ name: `Manual Spread ${suffix}`, barcode: enrichCode })
      .expect(201);
    const before = await prisma.product.findUnique({ where: { id: created.body.id } });
    expect(before!.offCheckedAt).toBeNull();

    // ...while the ?import=true row from the first test was born enriched.
    const imported = await prisma.product.findUnique({ where: { barcode: importCode } });
    expect(imported!.offCheckedAt).not.toBeNull();

    // Pin the sweep to this test's row — a shared dev DB may hold other
    // never-checked products, and stamping them here would be a side effect.
    await prisma.product.updateMany({
      where: { barcode: { not: enrichCode }, offCheckedAt: null },
      data: { offCheckedAt: new Date() },
    });

    // Respect the OFF client's one-call-per-second etiquette throttle.
    await new Promise((resolve) => setTimeout(resolve, OFF_MIN_CALL_INTERVAL_MS + 100));
    const summary = await app.get(ProductEnrichmentService).enrichUnchecked();
    expect(summary).toMatchObject({ scanned: 1, enriched: 1, halted: false });

    const after = await prisma.product.findUnique({
      where: { id: created.body.id },
      include: { aliases: true },
    });
    expect(after!.offCheckedAt).not.toBeNull();
    expect(after!.brand).toBe('Ferrero'); // gap filled from OFF
    expect(after!.name).toBe(`Manual Spread ${suffix}`); // user name untouched
    expect(after!.aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'off', name: `Stub Nutella ${suffix}` }),
      ]),
    );
  });
});
