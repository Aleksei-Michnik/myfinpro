import { ACCOUNT_IMPORT_MAX_LINES } from '@myfinpro/shared';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 20 · Iteration 20.4 — the limits around an import, from the security
 * review: a full `ACCOUNT_IMPORT_MAX_LINES` chunk must actually fit through
 * the body parser (M4), and the bank balance an import carries must be
 * bounded like every other date it carries (M1).
 *
 * Its own file because POST /imports is throttled to 10/min per route and the
 * main import suite already spends most of that budget.
 */
describe('Account statement import limits (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let owner: Awaited<ReturnType<typeof registerUser>>;
  let accountId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);
    owner = await registerUser(app, `imp-lim-${suffix}@test.local`);

    accountId = (
      await prisma.account.create({
        data: {
          name: `Limits ${suffix}`,
          kind: 'BANK',
          currency: 'ILS',
          scopeType: 'personal',
          ownerId: owner.user.id,
          createdById: owner.user.id,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.accountStatementLine.deleteMany({ where: { accountId } });
    await prisma.accountImport.deleteMany({ where: { accountId } });
    await prisma.account.deleteMany({ where: { createdById: owner.user.id } });
    await prisma.auditLog.deleteMany({ where: { userId: owner.user.id } });
    await app.close();
  });

  const postImport = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/v1/accounts/${accountId}/imports`)
      .set(auth(owner.accessToken))
      .send(body);

  it('accepts a full chunk of ACCOUNT_IMPORT_MAX_LINES lines', async () => {
    // Every line at the column maximum, in Hebrew — the worst case the web
    // wizard can produce for one chunk, ≈1.4 MB of JSON.
    const description = 'קניות שבועיות בסופרמרקט השכונתי ליד הבית '.repeat(7).slice(0, 300);
    const lines = Array.from({ length: ACCOUNT_IMPORT_MAX_LINES }, (_, i) => ({
      postedAt: '2026-09-10',
      amountCents: 100 + i,
      direction: 'OUT',
      description,
      memo: description,
      externalId: `X-${i}`,
    }));

    const res = await postImport({ source: 'hapoalim', lines }).expect(201);

    expect(res.body).toMatchObject({
      totalCount: ACCOUNT_IMPORT_MAX_LINES,
      insertedCount: ACCOUNT_IMPORT_MAX_LINES,
      duplicateCount: 0,
    });
    expect(await prisma.accountStatementLine.count({ where: { accountId } })).toBe(
      ACCOUNT_IMPORT_MAX_LINES,
    );
  }, 60_000);

  it('rejects a statement balance dated outside the plausible range', async () => {
    const res = await postImport({
      source: 'hapoalim',
      lines: [
        {
          postedAt: '2026-09-11',
          amountCents: 5000,
          direction: 'OUT',
          description: 'תשלום',
        },
      ],
      statementBalanceCents: 123456,
      statementBalanceAt: '2999-01-01',
    }).expect(400);

    expect(res.body.errorCode).toBe('ACCOUNT_IMPORT_INVALID_BALANCE');
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.reportedBalanceCents).toBeNull();
  });

  it('lets a corrected statement of the same day fix the reported balance', async () => {
    const balanceAt = '2026-09-12';
    await postImport({
      source: 'hapoalim',
      lines: [{ postedAt: balanceAt, amountCents: 2500, direction: 'OUT', description: 'קפה' }],
      statementBalanceCents: 100000,
      statementBalanceAt: balanceAt,
    }).expect(201);

    const corrected = await postImport({
      source: 'hapoalim',
      lines: [{ postedAt: balanceAt, amountCents: 2600, direction: 'OUT', description: 'מאפה' }],
      statementBalanceCents: 97400,
      statementBalanceAt: balanceAt,
    }).expect(201);
    expect(corrected.body.statementBalanceCents).toBe(97400);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.reportedBalanceCents).toBe(97400);
    expect(account.reportedBalanceAt?.toISOString().slice(0, 10)).toBe(balanceAt);
  });
});
