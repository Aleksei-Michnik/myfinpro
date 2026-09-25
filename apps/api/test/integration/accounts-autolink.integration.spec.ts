import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { StatementMatchingService } from '../../src/account/matching/statement-matching.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 20 · Iteration 20.6 — two-way enrichment, the transaction → line
 * direction (design §5.5).
 *
 * End-to-end through the real AppModule, so the realtime bus, the
 * auto-linker and the review queue are the ones production wires: a
 * statement is imported first, then transactions arrive the way a user (or a
 * confirmed receipt) makes them arrive, and the single confident bank line
 * takes itself off the queue — while an ambiguous pair stays untouched.
 *
 * Also pins the other direction's promise for a plan occurrence: a bank line
 * matched from the queue settles a PENDING occurrence to POSTED (§5.5,
 * shipped in 20.4).
 */
describe('Statement auto-link (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let matching: StatementMatchingService;

  let owner: Awaited<ReturnType<typeof registerUser>>;
  let accountId: string;
  let groceriesCategoryId: string;
  let occurrenceId: string;
  const lineIds: Record<string, string> = {};

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const auth = () => ({ Authorization: `Bearer ${owner.accessToken}` });

  const COFFEE = 'COFFEE ROASTERS TLV';
  const PHARMACY = 'PHARMACY DIZENGOFF';
  const GYM = 'GYM MONTHLY PLAN';
  const DOUBLE = 'DOUBLE CHARGE KIOSK';

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    matching = app.get(StatementMatchingService);

    await seedSystemCategories(prisma);
    owner = await registerUser(app, `autolink-${suffix}@test.local`);

    groceriesCategoryId = (await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    }))!.id;

    accountId = (
      await prisma.account.create({
        data: {
          name: `Checking ${suffix}`,
          kind: 'BANK',
          institution: 'hapoalim',
          currency: 'ILS',
          scopeType: 'personal',
          ownerId: owner.user.id,
          createdById: owner.user.id,
          openingBalanceCents: 500000,
          openingBalanceAt: new Date('2026-09-01T00:00:00Z'),
        },
      })
    ).id;

    // A plan occurrence the app generated but the bank has not confirmed yet
    // — the row a matched line settles (§5.5).
    const plan = await prisma.transaction.create({
      data: {
        direction: 'OUT',
        type: 'INSTALLMENT',
        amountCents: 15000,
        currency: 'ILS',
        occurredAt: new Date('2026-09-01T00:00:00Z'),
        status: 'POSTED',
        categoryId: groceriesCategoryId,
        note: GYM,
        createdById: owner.user.id,
        attributions: { create: [{ scopeType: 'personal', userId: owner.user.id }] },
      },
    });
    occurrenceId = (
      await prisma.transaction.create({
        data: {
          direction: 'OUT',
          type: 'ONE_TIME',
          amountCents: 15000,
          currency: 'ILS',
          occurredAt: new Date('2026-09-12T00:00:00Z'),
          status: 'PENDING',
          categoryId: groceriesCategoryId,
          note: GYM,
          parentTransactionId: plan.id,
          createdById: owner.user.id,
          attributions: { create: [{ scopeType: 'personal', userId: owner.user.id }] },
        },
      })
    ).id;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${accountId}/imports`)
      .set(auth())
      .send({
        source: 'hapoalim',
        originalName: 'statement.xlsx',
        lines: [
          { postedAt: '2026-09-10', amountCents: 4200, direction: 'OUT', description: COFFEE },
          { postedAt: '2026-09-11', amountCents: 7700, direction: 'OUT', description: PHARMACY },
          { postedAt: '2026-09-12', amountCents: 15000, direction: 'OUT', description: GYM },
          {
            postedAt: '2026-09-13',
            amountCents: 3300,
            direction: 'OUT',
            description: DOUBLE,
            externalId: 'D-1',
          },
          {
            postedAt: '2026-09-13',
            amountCents: 3300,
            direction: 'OUT',
            description: DOUBLE,
            externalId: 'D-2',
          },
        ],
      })
      .expect(201);
    expect(res.body.insertedCount).toBe(5);

    const lines = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${accountId}/lines?limit=100`)
      .set(auth())
      .expect(200);
    for (const line of lines.body.data) {
      lineIds[line.externalId ?? line.description] = line.id;
    }
  });

  afterAll(async () => {
    const accountIds = (
      await prisma.account.findMany({
        where: { createdById: owner.user.id },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.accountStatementLine.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.accountImport.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.transaction.deleteMany({ where: { createdById: owner.user.id } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: owner.user.id } });
    await app.close();
  });

  /** The link is post-commit and best-effort: poll the line, never sleep blind. */
  async function waitForLink(lineId: string, timeoutMs = 10_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await prisma.accountStatementLine.findUnique({ where: { id: lineId } });
      if (row?.status === 'MATCHED' && row.transactionId) return row.transactionId;
      if (Date.now() > deadline) {
        throw new Error(`line ${lineId} stayed ${row?.status} with no transaction`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  const createTransaction = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/v1/transactions')
      .set(auth())
      .send({
        direction: 'OUT',
        type: 'ONE_TIME',
        currency: 'ILS',
        categoryIds: [groceriesCategoryId],
        attributions: [{ scope: 'personal' }],
        ...body,
      });

  it('takes the pending line off the queue when the transaction is created on the account', async () => {
    const created = await createTransaction({
      amountCents: 4200,
      occurredAt: '2026-09-10T09:00:00.000Z',
      note: COFFEE,
      accountId,
    }).expect(201);

    // The response does not wait on the link — the queue catches up.
    expect(created.body.statementLineId).toBeNull();
    const linkedTo = await waitForLink(lineIds[COFFEE]);
    expect(linkedTo).toBe(created.body.id);

    const matched = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${accountId}/lines?status=MATCHED`)
      .set(auth())
      .expect(200);
    expect(matched.body.data).toEqual([
      expect.objectContaining({ id: lineIds[COFFEE], transactionId: created.body.id }),
    ]);

    const transaction = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${created.body.id}`)
      .set(auth())
      .expect(200);
    expect(transaction.body).toMatchObject({
      accountId,
      status: 'POSTED',
      statementLineId: lineIds[COFFEE],
    });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'STATEMENT_LINE_MATCHED', entityId: lineIds[COFFEE] },
    });
    expect(audit).not.toBeNull();
  });

  it('links a transaction that is placed on the account only later', async () => {
    const created = await createTransaction({
      amountCents: 7700,
      occurredAt: '2026-09-11T19:30:00.000Z',
      note: PHARMACY,
    }).expect(201);
    expect(created.body.accountId).toBeNull();

    await request(app.getHttpServer())
      .patch(`/api/v1/transactions/${created.body.id}`)
      .set(auth())
      .send({ accountId })
      .expect(200);

    expect(await waitForLink(lineIds[PHARMACY])).toBe(created.body.id);
  });

  it('leaves two equally plausible lines alone', async () => {
    const created = await createTransaction({
      amountCents: 3300,
      occurredAt: '2026-09-13T12:00:00.000Z',
      note: DOUBLE,
      accountId,
    }).expect(201);

    // Called directly so the assertion is about the decision, not about
    // having waited long enough for the fire-and-forget one.
    expect(await matching.autoLink(owner.user.id, created.body.id)).toBeNull();

    const pending = await prisma.accountStatementLine.findMany({
      where: { id: { in: [lineIds['D-1'], lineIds['D-2']] } },
      select: { status: true, transactionId: true },
    });
    expect(pending).toEqual([
      { status: 'PENDING', transactionId: null },
      { status: 'PENDING', transactionId: null },
    ]);
  });

  it('settles a pending plan occurrence matched from the review queue', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${accountId}/lines/${lineIds[GYM]}/match`)
      .set(auth())
      .send({ transactionId: occurrenceId })
      .expect(200);

    expect(res.body.transaction).toMatchObject({
      id: occurrenceId,
      status: 'POSTED',
      accountId,
      statementLineId: lineIds[GYM],
    });
    expect(res.body.transaction.parentTransactionId).not.toBeNull();
  });
});
