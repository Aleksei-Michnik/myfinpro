import { createHash, createHmac } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * Create valid Telegram auth data with proper HMAC-SHA256 hash.
 * Mirrors the verification logic in telegram-auth.util.ts but in reverse.
 */
function createTelegramAuthData(
  botToken: string,
  data: Partial<{
    id: number;
    first_name: string;
    last_name: string;
    username: string;
    photo_url: string;
    auth_date: number;
  }>,
) {
  const authData = {
    id: 123456789,
    first_name: 'Test',
    auth_date: Math.floor(Date.now() / 1000),
    ...data,
  };

  // Build check string: sort fields alphabetically, join with \n
  const checkData: Record<string, string | number> = {
    id: authData.id,
    first_name: authData.first_name,
    auth_date: authData.auth_date,
  };
  if (authData.last_name) checkData.last_name = authData.last_name;
  if (authData.username) checkData.username = authData.username;
  if (authData.photo_url) checkData.photo_url = authData.photo_url;

  const checkString = Object.keys(checkData)
    .sort()
    .map((k) => `${k}=${checkData[k]}`)
    .join('\n');

  const secretKey = createHash('sha256').update(botToken).digest();
  const hmac = createHmac('sha256', secretKey).update(checkString).digest('hex');

  return { ...authData, hash: hmac };
}

describe('Telegram Auth Integration', () => {
  let app: INestApplication;
  let botToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    // Get bot token from env (set by testcontainers setup or .env)
    botToken = process.env.TELEGRAM_BOT_TOKEN || 'test-bot-token:ABC123';
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Helper: register a user and get access token ──────────────────────────
  async function registerUser(email: string, name = 'Test User') {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'SecurePass123', name })
      .expect(201);
    return {
      accessToken: res.body.accessToken as string,
      user: res.body.user,
    };
  }

  describe('POST /api/v1/auth/telegram/callback (unauthenticated)', () => {
    it('should create new user on first Telegram login', async () => {
      const authData = createTelegramAuthData(botToken, {
        id: 100001,
        first_name: 'TelegramNewUser',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/telegram/callback')
        .send(authData)
        .expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.name).toBe('TelegramNewUser');
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.accessToken.split('.')).toHaveLength(3);
    });

    it('should login existing user with linked Telegram account', async () => {
      const telegramId = 100002;
      const authData = createTelegramAuthData(botToken, {
        id: telegramId,
        first_name: 'ExistingTgUser',
      });

      // First login: creates user
      const firstRes = await request(app.getHttpServer())
        .post('/api/v1/auth/telegram/callback')
        .send(authData)
        .expect(200);

      const userId = firstRes.body.user.id;

      // Second login: same Telegram ID → same user
      const secondAuthData = createTelegramAuthData(botToken, {
        id: telegramId,
        first_name: 'ExistingTgUser',
      });

      const secondRes = await request(app.getHttpServer())
        .post('/api/v1/auth/telegram/callback')
        .send(secondAuthData)
        .expect(200);

      expect(secondRes.body.user.id).toBe(userId);
    });

    it('should reject invalid HMAC hash', async () => {
      const authData = createTelegramAuthData(botToken, {
        id: 100003,
        first_name: 'BadHash',
      });
      authData.hash = 'invalid-hash-value';

      await request(app.getHttpServer())
        .post('/api/v1/auth/telegram/callback')
        .send(authData)
        .expect(401);
    });

    it('should reject expired auth_date', async () => {
      const authData = createTelegramAuthData(botToken, {
        id: 100004,
        first_name: 'Expired',
        auth_date: Math.floor(Date.now() / 1000) - 90000, // > 24h ago
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/telegram/callback')
        .send(authData)
        .expect(401);
    });

    it('should handle missing optional fields (no username, no photo)', async () => {
      const authData = createTelegramAuthData(botToken, {
        id: 100005,
        first_name: 'MinimalUser',
        // no last_name, username, photo_url
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/telegram/callback')
        .send(authData)
        .expect(200);

      expect(res.body.user).toBeDefined();
      expect(res.body.user.name).toBe('MinimalUser');
    });

    it('should set refresh token cookie', async () => {
      const authData = createTelegramAuthData(botToken, {
        id: 100006,
        first_name: 'CookieUser',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/telegram/callback')
        .send(authData)
        .expect(200);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
      const refreshCookie = cookieArray.find((c: string) => c.startsWith('refresh_token='));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
    });

    it('should return valid JWT access token', async () => {
      const authData = createTelegramAuthData(botToken, {
        id: 100007,
        first_name: 'JwtUser',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/telegram/callback')
        .send(authData)
        .expect(200);

      const token = res.body.accessToken;
      expect(token).toBeDefined();
      expect(token.split('.')).toHaveLength(3);

      // Verify the token works for /auth/me
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  describe('GET /api/v1/auth/connected-accounts', () => {
    it('should return providers list for authenticated user', async () => {
      const { accessToken } = await registerUser('connected-test@example.com');

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/connected-accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.hasPassword).toBe(true);
      expect(Array.isArray(res.body.providers)).toBe(true);
    });

    it('should include hasPassword flag', async () => {
      // Telegram-only user has no password
      const authData = createTelegramAuthData(botToken, {
        id: 200001,
        first_name: 'NoPassUser',
      });

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/telegram/callback')
        .send(authData)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/connected-accounts')
        .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
        .expect(200);

      expect(res.body.hasPassword).toBe(false);
      expect(res.body.providers).toEqual(
        expect.arrayContaining([expect.objectContaining({ provider: 'telegram' })]),
      );
    });

    it('should return 401 without auth token', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/connected-accounts').expect(401);
    });
  });

  describe('POST /api/v1/auth/link/telegram', () => {
    it('should link Telegram to existing email/password user', async () => {
      const { accessToken } = await registerUser('link-tg-test@example.com');

      const authData = createTelegramAuthData(botToken, {
        id: 300001,
        first_name: 'LinkedTg',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/link/telegram')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(authData)
        .expect(200);

      // Should return updated connected accounts
      expect(res.body.hasPassword).toBe(true);
      expect(res.body.providers).toEqual(
        expect.arrayContaining([expect.objectContaining({ provider: 'telegram' })]),
      );
    });

    it('should reject if Telegram already linked to another user', async () => {
      const telegramId = 300002;

      // First user links this Telegram ID
      const { accessToken: token1 } = await registerUser('link-tg-first@example.com');
      const authData1 = createTelegramAuthData(botToken, {
        id: telegramId,
        first_name: 'FirstLink',
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/link/telegram')
        .set('Authorization', `Bearer ${token1}`)
        .send(authData1)
        .expect(200);

      // Second user tries to link the same Telegram ID → 409
      const { accessToken: token2 } = await registerUser('link-tg-second@example.com');
      const authData2 = createTelegramAuthData(botToken, {
        id: telegramId,
        first_name: 'FirstLink',
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/link/telegram')
        .set('Authorization', `Bearer ${token2}`)
        .send(authData2)
        .expect(409);
    });

    it('should return updated list if already linked to same user', async () => {
      const { accessToken } = await registerUser('link-tg-same@example.com');
      const telegramId = 300003;

      const authData = createTelegramAuthData(botToken, {
        id: telegramId,
        first_name: 'SameLink',
      });

      // Link once
      await request(app.getHttpServer())
        .post('/api/v1/auth/link/telegram')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(authData)
        .expect(200);

      // Link again — same user → should succeed
      const authData2 = createTelegramAuthData(botToken, {
        id: telegramId,
        first_name: 'SameLink',
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/link/telegram')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(authData2)
        .expect(200);

      expect(res.body.providers).toEqual(
        expect.arrayContaining([expect.objectContaining({ provider: 'telegram' })]),
      );
    });

    it('should return 401 without auth token', async () => {
      const authData = createTelegramAuthData(botToken, {
        id: 300004,
        first_name: 'NoAuth',
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/link/telegram')
        .send(authData)
        .expect(401);
    });
  });

  describe('DELETE /api/v1/auth/connected-accounts/:provider', () => {
    it('should unlink a provider when user has password', async () => {
      const { accessToken } = await registerUser('unlink-test@example.com');

      // Link Telegram first
      const authData = createTelegramAuthData(botToken, {
        id: 400001,
        first_name: 'Unlink',
      });
      await request(app.getHttpServer())
        .post('/api/v1/auth/link/telegram')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(authData)
        .expect(200);

      // Now unlink Telegram
      const res = await request(app.getHttpServer())
        .delete('/api/v1/auth/connected-accounts/telegram')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Should return updated list without Telegram
      const tgProviders = res.body.providers.filter(
        (p: { provider: string }) => p.provider === 'telegram',
      );
      expect(tgProviders).toHaveLength(0);
      expect(res.body.hasPassword).toBe(true);
    });

    it('should reject unlink if it would leave no auth method', async () => {
      // Create a Telegram-only user (no password)
      const authData = createTelegramAuthData(botToken, {
        id: 400002,
        first_name: 'OnlyTg',
      });
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/telegram/callback')
        .send(authData)
        .expect(200);

      // Try to unlink Telegram → should fail
      await request(app.getHttpServer())
        .delete('/api/v1/auth/connected-accounts/telegram')
        .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
        .expect(400)
        .expect((res: request.Response) => {
          expect(res.body.message).toContain('Cannot unlink the last');
        });
    });

    it('should return 401 without auth token', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/auth/connected-accounts/telegram')
        .expect(401);
    });

    it('should return 404 for unlinked provider', async () => {
      const { accessToken } = await registerUser('unlink-404@example.com');

      await request(app.getHttpServer())
        .delete('/api/v1/auth/connected-accounts/telegram')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });
});
