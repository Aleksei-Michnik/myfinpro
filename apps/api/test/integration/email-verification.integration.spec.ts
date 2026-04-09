import * as crypto from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, hashToken, registerUser } from './helpers';

/**
 * Integration tests for the Email Verification feature.
 *
 * Covers:
 * - Verification token creation on registration
 * - GET /auth/verify-email with valid/invalid/empty tokens
 * - POST /auth/send-verification-email (resend, already verified, no auth)
 */
describe('Email Verification Integration Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create email verification token on registration', async () => {
    const { user } = await registerUser(app, 'ev-reg@example.com');

    expect(user.emailVerified).toBe(false);

    const tokens = await prisma.emailVerificationToken.findMany({
      where: { userId: user.id },
    });
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    expect(tokens[0].usedAt).toBeNull();
  });

  it('GET /auth/verify-email?token=... should verify email with valid token', async () => {
    const { user } = await registerUser(app, 'ev-valid@example.com');

    // Create a known token so we control the raw value
    const rawToken = crypto.randomUUID();
    const tokenHash = hashToken(rawToken);

    await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
    await prisma.emailVerificationToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/auth/verify-email?token=${rawToken}`)
      .expect(200);

    expect(res.body.message).toBe('Email verified successfully');

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { emailVerified: true },
    });
    expect(dbUser?.emailVerified).toBe(true);
  });

  it('GET /auth/verify-email with invalid token should return 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/verify-email?token=invalid-token-value')
      .expect(401);
  });

  it('GET /auth/verify-email with empty token should return 400', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/verify-email?token=').expect(400);
  });

  it('POST /auth/send-verification-email should resend verification', async () => {
    const { accessToken } = await registerUser(app, 'ev-resend@example.com');

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/send-verification-email')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.message).toBe('Verification email sent');
  });

  it('POST /auth/send-verification-email should handle already verified user', async () => {
    const { user, accessToken } = await registerUser(app, 'ev-already@example.com');

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/send-verification-email')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.message).toBe('Email already verified');
  });

  it('POST /auth/send-verification-email without auth should return 401', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/send-verification-email').expect(401);
  });
});
