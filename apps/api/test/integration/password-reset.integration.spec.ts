import * as crypto from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, hashToken, registerUser } from './helpers';

/**
 * Integration tests for the Password Reset feature.
 *
 * Covers:
 * - POST /auth/forgot-password (creates token, generic message, invalid email)
 * - POST /auth/reset-password (valid token, invalid/expired/used tokens)
 * - Login with new password succeeds / old password fails after reset
 */
describe('Password Reset Integration Tests', () => {
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

  it('POST /auth/forgot-password should return generic message (prevents enumeration)', async () => {
    await registerUser(app, 'pr-flow@example.com');

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'pr-flow@example.com' })
      .expect(200);

    expect(res.body.message).toContain('If an account with this email exists');
  });

  it('POST /auth/forgot-password should return same message for non-existent email', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nonexistent-pr@example.com' })
      .expect(200);

    expect(res.body.message).toContain('If an account with this email exists');
  });

  it('POST /auth/forgot-password should create a password reset token in DB', async () => {
    const { user } = await registerUser(app, 'pr-token-check@example.com');

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'pr-token-check@example.com' })
      .expect(200);

    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: user.id },
    });
    expect(tokens.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /auth/reset-password with valid token should reset password', async () => {
    const { user } = await registerUser(app, 'pr-valid@example.com', 'OldPass123');

    const rawToken = crypto.randomUUID();
    const tokenHash = hashToken(rawToken);

    await prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'NewSecurePass456' })
      .expect(200);

    expect(res.body.message).toContain('Password reset successfully');

    // Login with the new password should succeed
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'pr-valid@example.com', password: 'NewSecurePass456' })
      .expect(200);
  });

  it('POST /auth/reset-password with invalid token should return 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'invalid-reset-token', password: 'NewSecurePass456' })
      .expect(401);
  });

  it('POST /auth/reset-password with expired token should return 401', async () => {
    const { user } = await registerUser(app, 'pr-expired@example.com');

    const rawToken = crypto.randomUUID();
    const tokenHash = hashToken(rawToken);

    await prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000), // 1h in the past
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'NewSecurePass456' })
      .expect(401);
  });

  it('POST /auth/reset-password with already-used token should return 400', async () => {
    const { user } = await registerUser(app, 'pr-used@example.com');

    const rawToken = crypto.randomUUID();
    const tokenHash = hashToken(rawToken);

    await prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        usedAt: new Date(), // Already used
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'NewSecurePass456' })
      .expect(400);
  });

  it('login with old password should fail after password reset', async () => {
    const { user } = await registerUser(app, 'pr-old-login@example.com', 'OldPass123');

    const rawToken = crypto.randomUUID();
    const tokenHash = hashToken(rawToken);

    await prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'BrandNewPass789' })
      .expect(200);

    // Old password should fail
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'pr-old-login@example.com', password: 'OldPass123' })
      .expect(401);

    // New password should work
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'pr-old-login@example.com', password: 'BrandNewPass789' })
      .expect(200);
  });

  it('POST /auth/forgot-password with invalid email format should return 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not-an-email' })
      .expect(400);
  });
});
