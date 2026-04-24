import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Integration tests for the Password Change feature.
 *
 * Covers:
 * - POST /auth/change-password (requires JWT auth)
 * - Happy path: login with new password succeeds, old password fails
 * - Error cases: wrong current, OAuth-only user, same-as-current, validation
 */
describe('Password Change Integration Tests', () => {
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

  it('POST /auth/change-password should change password and invalidate refresh tokens', async () => {
    const { accessToken, user } = await registerUser(app, 'pc-happy@example.com', 'OldPass123');

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'OldPass123', newPassword: 'BrandNewPass456' })
      .expect(204);

    // New password should work
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'pc-happy@example.com', password: 'BrandNewPass456' })
      .expect(200);

    // Old password should fail
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'pc-happy@example.com', password: 'OldPass123' })
      .expect(401);

    // Refresh tokens should be revoked
    const tokens = await prisma.refreshToken.findMany({
      where: { userId: user.id, revokedAt: null },
    });
    expect(tokens).toHaveLength(0);
  });

  it('POST /auth/change-password without auth should return 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'OldPass123', newPassword: 'NewPass456' })
      .expect(401);
  });

  it('POST /auth/change-password with wrong current password should return 400', async () => {
    const { accessToken } = await registerUser(app, 'pc-wrong@example.com', 'OldPass123');

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'WrongPass123', newPassword: 'NewSecurePass456' })
      .expect(400);

    expect(res.body.errorCode).toBe('AUTH_INVALID_CURRENT_PASSWORD');
  });

  it('POST /auth/change-password with same new as current should return 400', async () => {
    const { accessToken } = await registerUser(app, 'pc-same@example.com', 'SamePass123');

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'SamePass123', newPassword: 'SamePass123' })
      .expect(400);

    expect(res.body.errorCode).toBe('AUTH_PASSWORD_SAME_AS_CURRENT');
  });

  it('POST /auth/change-password with weak new password should return 400 (validation)', async () => {
    const { accessToken } = await registerUser(app, 'pc-weak@example.com', 'OldPass123');

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'OldPass123', newPassword: 'short' })
      .expect(400);
  });

  it('POST /auth/change-password for OAuth-only user should return 400 PASSWORD_NOT_SET', async () => {
    // Register a normal user, then null out the passwordHash to simulate OAuth-only
    const { accessToken, user } = await registerUser(app, 'pc-oauth@example.com', 'InitPass123');
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: null },
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'Anything1A', newPassword: 'NewSecurePass456' })
      .expect(400);

    expect(res.body.errorCode).toBe('AUTH_PASSWORD_NOT_SET');
  });

  it('POST /auth/change-password should create an audit log entry', async () => {
    const { accessToken, user } = await registerUser(app, 'pc-audit@example.com', 'OldPass123');

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'OldPass123', newPassword: 'BrandNewPass456' })
      .expect(204);

    const auditLogs = await prisma.auditLog.findMany({
      where: { userId: user.id, action: 'auth.password_changed' },
    });
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
  });
});
