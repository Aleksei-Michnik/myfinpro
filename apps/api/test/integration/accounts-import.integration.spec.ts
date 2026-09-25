import * as crypto from 'crypto';
import { TRANSFER_CATEGORY_SLUG } from '@myfinpro/shared';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Phase 20 · Iteration 20.4 — statement import + review queue integration
 * tests (design §5, §6.2).
 *
 * End-to-end through the real AppModule: import with fingerprint dedup, the
 * matcher's proposals (exact-amount match, card-bill transfer, category
 * memory), the server-side `suggestion=` filters, every line decision and
 * its effect on the transaction, and the role matrix.
 *
 * Users: `owner` (personal bank + card, admin of the group), `member` (group
 * member — may import, it is data entry), `outsider` (no access).
 *
 * Import requests are throttled to 10/min per route, so the suite keeps its
 * POST /imports calls to five and seeds everything else through Prisma.
 */
describe('Account statement imports (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let owner: Awaited<ReturnType<typeof registerUser>>;
  let member: Awaited<ReturnType<typeof registerUser>>;
  let outsider: Awaited<ReturnType<typeof registerUser>>;
  let groupId: string;

  let checkingId: string;
  let cardId: string;
  let groupBankId: string;
  let groceriesCategoryId: string;

  /** The transaction the app already had when the statement arrived. */
  let pendingTransactionId: string;
  /** Lines of the first import, by description. */
  const lineIds: Record<string, string> = {};
  let firstImportId: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const SUPER_PHARM = 'סופר פארם דיזנגוף';
  const CARD_BILL = 'ישראכרט חיוב חודשי';
  const BAKERY = 'מאפיית לחם הארץ';
  const SALARY = 'משכורת ספטמבר';

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    owner = await registerUser(app, `imp-owner-${suffix}@test.local`);
    member = await registerUser(app, `imp-member-${suffix}@test.local`);
    outsider = await registerUser(app, `imp-outsider-${suffix}@test.local`);

    const groupRes = await request(app.getHttpServer())
      .post('/api/v1/groups')
      .set(auth(owner.accessToken))
      .send({ name: `Import Fam ${suffix}`, type: 'family' })
      .expect(201);
    groupId = groupRes.body.id;
    await prisma.group.update({ where: { id: groupId }, data: { defaultCurrency: 'ILS' } });
    await prisma.groupMembership.create({
      data: { groupId, userId: member.user.id, role: 'member' },
    });

    groceriesCategoryId = (await prisma.category.findFirst({
      where: { ownerType: 'system', direction: 'OUT', slug: 'groceries' },
    }))!.id;

    checkingId = (
      await prisma.account.create({
        data: {
          name: `Checking ${suffix}`,
          kind: 'BANK',
          institution: 'hapoalim',
          currency: 'ILS',
          scopeType: 'personal',
          ownerId: owner.user.id,
          createdById: owner.user.id,
          openingBalanceCents: 100000,
          openingBalanceAt: new Date('2026-09-01T00:00:00Z'),
        },
      })
    ).id;
    cardId = (
      await prisma.account.create({
        data: {
          name: `Isracard ${suffix}`,
          kind: 'CARD',
          institution: 'isracard',
          currency: 'ILS',
          scopeType: 'personal',
          ownerId: owner.user.id,
          createdById: owner.user.id,
          billingAccountId: checkingId,
          billingDay: 10,
        },
      })
    ).id;
    groupBankId = (
      await prisma.account.create({
        data: {
          name: `Household ${suffix}`,
          kind: 'BANK',
          currency: 'ILS',
          scopeType: 'group',
          groupId,
          createdById: owner.user.id,
        },
      })
    ).id;

    // The app already knew about the pharmacy purchase — as an unposted,
    // unplaced row, exactly what §5.5 enriches.
    pendingTransactionId = (
      await prisma.transaction.create({
        data: {
          direction: 'OUT',
          type: 'ONE_TIME',
          amountCents: 12500,
          currency: 'ILS',
          occurredAt: new Date('2026-09-11T00:00:00Z'),
          status: 'PENDING',
          categoryId: groceriesCategoryId,
          note: SUPER_PHARM,
          createdById: owner.user.id,
          attributions: { create: [{ scopeType: 'personal', userId: owner.user.id }] },
        },
      })
    ).id;
  });

  afterAll(async () => {
    const userIds = [owner.user.id, member.user.id, outsider.user.id];
    const accountIds = (
      await prisma.account.findMany({
        where: { createdById: { in: userIds } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.accountStatementLine.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.accountImport.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.transaction.deleteMany({ where: { createdById: { in: userIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await app.close();
  });

  const statementLines = () => [
    {
      postedAt: '2026-09-10',
      amountCents: 12500,
      direction: 'OUT',
      description: SUPER_PHARM,
      externalId: 'A-1001',
      balanceAfterCents: 87500,
    },
    {
      postedAt: '2026-09-10',
      amountCents: 124000,
      direction: 'OUT',
      description: CARD_BILL,
      externalId: 'A-1002',
    },
    {
      postedAt: '2026-09-12',
      amountCents: 8800,
      direction: 'OUT',
      description: BAKERY,
      externalId: 'A-1003',
    },
    {
      postedAt: '2026-09-13',
      amountCents: 500000,
      direction: 'IN',
      description: SALARY,
      externalId: 'A-1004',
    },
  ];

  const importBody = (over: Record<string, unknown> = {}) => ({
    source: 'hapoalim',
    originalName: 'statement.xlsx',
    lines: statementLines(),
    statementBalanceCents: 455700,
    statementBalanceAt: '2026-09-13',
    periodFrom: '2026-09-01',
    periodTo: '2026-09-13',
    ...over,
  });

  const listLines = (query = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/accounts/${checkingId}/lines${query}`)
      .set(auth(owner.accessToken));

  // ── import ──

  it('imports a statement, counts the matcher’s proposals and records the bank balance', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/imports`)
      .set(auth(owner.accessToken))
      .send(importBody())
      .expect(201);

    firstImportId = res.body.id;
    expect(res.body).toMatchObject({
      accountId: checkingId,
      importedById: owner.user.id,
      source: 'hapoalim',
      originalName: 'statement.xlsx',
      totalCount: 4,
      insertedCount: 4,
      duplicateCount: 0,
      // The pharmacy row matches the pending transaction; the Isracard row is
      // the card bill; the bakery and the salary need a category.
      suggestedMatchCount: 1,
      suggestedTransferCount: 1,
      suggestedCreateCount: 0,
      needsInputCount: 2,
    });

    const account = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${checkingId}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(account.body.reportedBalanceCents).toBe(455700);
    expect(account.body.pendingLinesCount).toBe(4);
    expect(account.body.reconciliationGapCents).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ACCOUNT_IMPORT_CREATED', entityId: firstImportId },
    });
    expect(audit).not.toBeNull();

    const lines = await listLines('?limit=100').expect(200);
    for (const line of lines.body.data) lineIds[line.description] = line.id;
    expect(Object.keys(lineIds)).toHaveLength(4);
  });

  it('re-importing the same statement inserts nothing and counts duplicates', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/imports`)
      .set(auth(owner.accessToken))
      .send(importBody())
      .expect(201);

    expect(res.body).toMatchObject({ totalCount: 4, insertedCount: 0, duplicateCount: 4 });
    expect(await prisma.accountStatementLine.count({ where: { accountId: checkingId } })).toBe(4);
  });

  it('rejects a line in another currency and one that is too large, by index only', async () => {
    const currencyRes = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/imports`)
      .set(auth(owner.accessToken))
      .send(
        importBody({
          lines: [{ ...statementLines()[0], currency: 'USD', externalId: 'A-2001' }],
        }),
      )
      .expect(400);
    expect(currencyRes.body.errorCode).toBe('ACCOUNT_CURRENCY_MISMATCH');
    expect(currencyRes.body.message).toContain('Line 0');
    expect(currencyRes.body.message).not.toContain(SUPER_PHARM);
  });

  // ── the matcher's proposals ──

  it('proposes the exact-amount transaction inside the window, resolved for the UI', async () => {
    const res = await listLines('?suggestion=match').expect(200);

    expect(res.body.data).toHaveLength(1);
    const line = res.body.data[0];
    expect(line.description).toBe(SUPER_PHARM);
    expect(line.suggestion).toMatchObject({ action: 'match', transferAccountId: null });
    expect(line.suggestion.score).toBeGreaterThanOrEqual(0.8);
    expect(line.suggestion.transaction).toMatchObject({
      id: pendingTransactionId,
      amountCents: 12500,
      status: 'PENDING',
      accountId: null,
    });
    expect(line.suggestion.candidates[0].transaction.id).toBe(pendingTransactionId);
  });

  it('proposes a transfer for the card bill of a card this account pays', async () => {
    const res = await listLines('?suggestion=transfer').expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      description: CARD_BILL,
      suggestion: { action: 'transfer', transferAccountId: cardId },
    });
  });

  it('filters the review queue server-side, needs_input first', async () => {
    const needsInput = await listLines('?suggestion=needs_input').expect(200);
    expect(
      needsInput.body.data.map((line: { description: string }) => line.description).sort(),
    ).toEqual([BAKERY, SALARY].sort());

    const create = await listLines('?suggestion=create').expect(200);
    expect(create.body.data).toHaveLength(0);

    const byImport = await listLines(`?importId=${firstImportId}&limit=100`).expect(200);
    expect(byImport.body.data).toHaveLength(4);

    const byStatus = await listLines('?status=PENDING&limit=100').expect(200);
    expect(byStatus.body.data).toHaveLength(4);
  });

  // ── decisions ──

  it('matching a line places the transaction on the account and posts it', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/lines/${lineIds[SUPER_PHARM]}/match`)
      .set(auth(owner.accessToken))
      .send({ transactionId: pendingTransactionId })
      .expect(200);

    expect(res.body.line).toMatchObject({
      status: 'MATCHED',
      transactionId: pendingTransactionId,
      decidedById: owner.user.id,
    });
    expect(res.body.transaction).toMatchObject({
      id: pendingTransactionId,
      status: 'POSTED',
      accountId: checkingId,
      statementLineId: lineIds[SUPER_PHARM],
    });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'STATEMENT_LINE_MATCHED', entityId: lineIds[SUPER_PHARM] },
    });
    expect(audit).not.toBeNull();
  });

  it('refuses a transaction that does not agree with the line, or is already linked', async () => {
    const other = await prisma.transaction.create({
      data: {
        direction: 'OUT',
        type: 'ONE_TIME',
        amountCents: 999,
        currency: 'ILS',
        occurredAt: new Date('2026-09-12T00:00:00Z'),
        status: 'POSTED',
        categoryId: groceriesCategoryId,
        createdById: owner.user.id,
        attributions: { create: [{ scopeType: 'personal', userId: owner.user.id }] },
      },
    });

    const mismatch = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/lines/${lineIds[BAKERY]}/match`)
      .set(auth(owner.accessToken))
      .send({ transactionId: other.id })
      .expect(400);
    expect(mismatch.body.errorCode).toBe('STATEMENT_MATCH_INVALID');

    const alreadyLinked = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/lines/${lineIds[SALARY]}/match`)
      .set(auth(owner.accessToken))
      .send({ transactionId: pendingTransactionId })
      .expect(409);
    expect(alreadyLinked.body.errorCode).toBe('STATEMENT_LINE_ALREADY_LINKED');

    const invisible = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/lines/${lineIds[SALARY]}/match`)
      .set(auth(owner.accessToken))
      .send({ transactionId: crypto.randomUUID() })
      .expect(404);
    expect(invisible.body.errorCode).toBe('TRANSACTION_NOT_FOUND');

    // The already-decided pharmacy line refuses a second decision.
    const decided = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/lines/${lineIds[SUPER_PHARM]}/ignore`)
      .set(auth(owner.accessToken))
      .expect(409);
    expect(decided.body.errorCode).toBe('STATEMENT_LINE_NOT_PENDING');
  });

  it('records the card bill as a transfer that counts as spending nowhere', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/lines/${lineIds[CARD_BILL]}/transfer`)
      .set(auth(owner.accessToken))
      .send({ transferAccountId: cardId })
      .expect(200);

    expect(res.body.line.status).toBe('CREATED');
    expect(res.body.transaction).toMatchObject({
      direction: 'OUT',
      amountCents: 124000,
      accountId: checkingId,
      transferAccountId: cardId,
    });
    expect(res.body.transaction.categories[0].slug).toBe(TRANSFER_CATEGORY_SLUG);
  });

  it('creates a transaction from a line, defaulting the note and the attribution', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/lines/${lineIds[BAKERY]}/create`)
      .set(auth(owner.accessToken))
      .send({ categoryIds: [groceriesCategoryId] })
      .expect(200);

    expect(res.body.line).toMatchObject({ status: 'CREATED' });
    expect(res.body.transaction).toMatchObject({
      direction: 'OUT',
      amountCents: 8800,
      currency: 'ILS',
      status: 'POSTED',
      accountId: checkingId,
      note: BAKERY,
    });
    expect(res.body.transaction.occurredAt.slice(0, 10)).toBe('2026-09-12');
    expect(res.body.transaction.attributions[0]).toMatchObject({ scope: 'personal' });
  });

  it('ignores a line and unlinks a decided one without touching its transaction', async () => {
    const ignored = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/lines/${lineIds[SALARY]}/ignore`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(ignored.body.line).toMatchObject({ status: 'IGNORED', transactionId: null });

    const unlinked = await request(app.getHttpServer())
      .delete(`/api/v1/accounts/${checkingId}/lines/${lineIds[SUPER_PHARM]}/link`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(unlinked.body.line).toMatchObject({
      status: 'PENDING',
      transactionId: null,
      decidedAt: null,
    });

    // The transaction keeps everything the match gave it — undoing the link
    // is not undoing the money (design §2.5).
    const transaction = await request(app.getHttpServer())
      .get(`/api/v1/transactions/${pendingTransactionId}`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(transaction.body).toMatchObject({
      status: 'POSTED',
      accountId: checkingId,
      statementLineId: null,
    });

    // Unlink is idempotent.
    await request(app.getHttpServer())
      .delete(`/api/v1/accounts/${checkingId}/lines/${lineIds[SUPER_PHARM]}/link`)
      .set(auth(owner.accessToken))
      .expect(200);
  });

  // ── memory and bulk apply ──

  it('remembers the category of an identical description and applies it in bulk', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/imports`)
      .set(auth(owner.accessToken))
      .send({
        source: 'hapoalim',
        lines: [
          {
            postedAt: '2026-09-20',
            amountCents: 9900,
            direction: 'OUT',
            description: BAKERY,
            externalId: 'B-2001',
          },
        ],
      })
      .expect(201);

    expect(res.body).toMatchObject({
      insertedCount: 1,
      suggestedCreateCount: 1,
      needsInputCount: 0,
    });

    const lines = await listLines(`?importId=${res.body.id}`).expect(200);
    expect(lines.body.data[0].suggestion).toMatchObject({
      action: 'create',
      categoryId: groceriesCategoryId,
    });
    expect(lines.body.data[0].suggestion.category.slug).toBe('groceries');

    const applied = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/lines/apply-suggestions`)
      .set(auth(owner.accessToken))
      .send({ lineIds: [lines.body.data[0].id] })
      .expect(200);
    expect(applied.body).toEqual({ matched: 0, transferred: 0, created: 1, skipped: 0 });

    const after = await listLines(`?importId=${res.body.id}`).expect(200);
    expect(after.body.data[0]).toMatchObject({ status: 'CREATED' });
    expect(after.body.data[0].transaction).toMatchObject({
      amountCents: 9900,
      accountId: checkingId,
    });
  });

  // ── role matrix ──

  it('lets a group member import into a group account', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${groupBankId}/imports`)
      .set(auth(member.accessToken))
      .send({
        source: 'generic_csv',
        lines: [
          {
            postedAt: '2026-09-15',
            amountCents: 4200,
            direction: 'OUT',
            description: 'קניות לבית',
            externalId: 'G-1',
          },
        ],
      })
      .expect(201);
    expect(res.body).toMatchObject({ accountId: groupBankId, insertedCount: 1 });

    const lines = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${groupBankId}/lines`)
      .set(auth(member.accessToken))
      .expect(200);
    expect(lines.body.data).toHaveLength(1);
  });

  it('404s an outsider on import, lines and decisions — existence is never leaked', async () => {
    const importRes = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${groupBankId}/imports`)
      .set(auth(outsider.accessToken))
      .send({
        source: 'generic_csv',
        lines: [
          {
            postedAt: '2026-09-15',
            amountCents: 100,
            direction: 'OUT',
            description: 'peek',
          },
        ],
      })
      .expect(404);
    expect(importRes.body.errorCode).toBe('ACCOUNT_NOT_FOUND');

    await request(app.getHttpServer())
      .get(`/api/v1/accounts/${checkingId}/lines`)
      .set(auth(outsider.accessToken))
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/accounts/${checkingId}/lines/${lineIds[SUPER_PHARM]}/ignore`)
      .set(auth(outsider.accessToken))
      .expect(404);
  });
});
