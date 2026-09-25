import { API_TOKEN_PREFIX, API_TOKEN_SCOPE_ACCOUNTS_IMPORT } from '@myfinpro/shared';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedSystemCategories } from '../../src/transaction/seed-system-categories';
import { bootstrapTestApp, hashToken, registerUser } from './helpers';

/**
 * Phase 20 · Iteration 20.7 — scoped personal access tokens (design §6.4).
 *
 * The property under test is structural: a token created in settings can push
 * statement lines into an account its owner can already reach, and it can do
 * nothing else — not read accounts, not manage tokens, not survive revocation
 * or its own expiry. The connector therefore keeps the bank credentials on
 * the user's machine and holds a capability, not an account.
 */
describe('Personal access tokens (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let owner: Awaited<ReturnType<typeof registerUser>>;
  let accountId: string;
  let tokenId: string;
  let rawToken: string;

  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** One statement line; `descriptionSuffix` keeps fingerprints distinct. */
  const importBody = (description: string) => ({
    source: 'connector',
    lines: [
      {
        postedAt: '2026-09-12',
        amountCents: 8800,
        direction: 'OUT',
        description,
      },
    ],
  });

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;

    await seedSystemCategories(prisma);

    owner = await registerUser(app, `pat-owner-${suffix}@test.local`);
    accountId = (
      await prisma.account.create({
        data: {
          name: `Connector checking ${suffix}`,
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
  });

  afterAll(async () => {
    await prisma.accountStatementLine.deleteMany({ where: { accountId } });
    await prisma.accountImport.deleteMany({ where: { accountId } });
    await prisma.transaction.deleteMany({ where: { createdById: owner.user.id } });
    await prisma.account.deleteMany({ where: { id: accountId } });
    await prisma.apiToken.deleteMany({ where: { userId: owner.user.id } });
    await prisma.auditLog.deleteMany({ where: { userId: owner.user.id } });
    await app.close();
  });

  it('creates a token, returns it once and never lists the secret again', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/tokens')
      .set(auth(owner.accessToken))
      .send({ name: 'Home laptop connector' })
      .expect(201);

    tokenId = res.body.id;
    rawToken = res.body.token;
    expect(rawToken.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(res.body).toMatchObject({
      name: 'Home laptop connector',
      scopes: [API_TOKEN_SCOPE_ACCOUNTS_IMPORT],
      expiresAt: null,
    });

    const stored = await prisma.apiToken.findUnique({ where: { id: tokenId } });
    expect(stored!.tokenHash).toBe(hashToken(rawToken));

    const list = await request(app.getHttpServer())
      .get('/api/v1/auth/tokens')
      .set(auth(owner.accessToken))
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: tokenId, lastUsedAt: null });
    expect(list.body[0].token).toBeUndefined();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'API_TOKEN_CREATED', entityId: tokenId },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit)).not.toContain(rawToken);
  });

  it('imports statement lines with the token, and the owner sees them with a JWT', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${accountId}/imports`)
      .set(auth(rawToken))
      .send(importBody('מאפיית לחם הארץ'))
      .expect(201);
    expect(res.body).toMatchObject({
      accountId,
      importedById: owner.user.id,
      source: 'connector',
      totalCount: 1,
      insertedCount: 1,
    });

    const lines = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${accountId}/lines`)
      .set(auth(owner.accessToken))
      .expect(200);
    expect(lines.body.data).toHaveLength(1);
    expect(lines.body.data[0]).toMatchObject({ amountCents: 8800, status: 'PENDING' });

    const used = await prisma.apiToken.findUnique({ where: { id: tokenId } });
    expect(used!.lastUsedAt).not.toBeNull();
  });

  it('is rejected everywhere else — the token authenticates one route only', async () => {
    await request(app.getHttpServer()).get('/api/v1/accounts').set(auth(rawToken)).expect(401);

    await request(app.getHttpServer())
      .get(`/api/v1/accounts/${accountId}/lines`)
      .set(auth(rawToken))
      .expect(401);

    await request(app.getHttpServer()).get('/api/v1/auth/tokens').set(auth(rawToken)).expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/tokens')
      .set(auth(rawToken))
      .send({ name: 'Escalation' })
      .expect(401);
  });

  it('403s a token that does not carry the accounts:import scope', async () => {
    const scopeless = `${API_TOKEN_PREFIX}scopelessAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    await prisma.apiToken.create({
      data: {
        tokenHash: hashToken(scopeless),
        userId: owner.user.id,
        name: 'Scopeless',
        scopes: '',
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/accounts/${accountId}/imports`)
      .set(auth(scopeless))
      .send(importBody('סקופלס'))
      .expect(403);
    expect(res.body.errorCode).toBe('API_TOKEN_SCOPE');
  });

  it('refuses to mint a token whose expiry has already passed', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/tokens')
      .set(auth(owner.accessToken))
      .send({ name: 'Born expired', expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .expect(400);
    expect(res.body.errorCode).toBe('API_TOKEN_EXPIRY_INVALID');
  });

  it('401s a token that has since expired', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/auth/tokens')
      .set(auth(owner.accessToken))
      .send({ name: 'Expires soon', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(201);

    // Time passes — the row is the clock the guard reads.
    await prisma.apiToken.update({
      where: { id: created.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/accounts/${accountId}/imports`)
      .set(auth(created.body.token))
      .send(importBody('פג תוקף'))
      .expect(401);
  });

  it('401s the import once the token is revoked', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/auth/tokens/${tokenId}`)
      .set(auth(owner.accessToken))
      .expect(204);

    await request(app.getHttpServer())
      .post(`/api/v1/accounts/${accountId}/imports`)
      .set(auth(rawToken))
      .send(importBody('אחרי ביטול'))
      .expect(401);

    const list = await request(app.getHttpServer())
      .get('/api/v1/auth/tokens')
      .set(auth(owner.accessToken))
      .expect(200);
    expect(list.body.find((token: { id: string }) => token.id === tokenId)).toBeUndefined();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'API_TOKEN_REVOKED', entityId: tokenId },
    });
    expect(audit).not.toBeNull();
  });

  it('404s revoking a token that is not the caller’s', async () => {
    const other = await registerUser(app, `pat-other-${suffix}@test.local`);
    const mine = await request(app.getHttpServer())
      .post('/api/v1/auth/tokens')
      .set(auth(owner.accessToken))
      .send({ name: 'Still mine' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/auth/tokens/${mine.body.id}`)
      .set(auth(other.accessToken))
      .expect(404);

    await prisma.apiToken.deleteMany({ where: { userId: other.user.id } });
    await prisma.auditLog.deleteMany({ where: { userId: other.user.id } });
  });
});
