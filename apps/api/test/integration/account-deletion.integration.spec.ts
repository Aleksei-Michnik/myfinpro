import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Integration tests for the Account Deletion feature.
 *
 * Covers:
 * - POST /auth/delete-account (soft-delete, wrong confirmation, no auth)
 * - POST /auth/cancel-deletion (reactivate, active account error)
 * - Login-based reactivation within grace period
 * - Login blocked after grace period expiry
 */
describe('Account Deletion Integration Tests', () => {
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

  it('POST /auth/delete-account should soft-delete user', async () => {
    const { user, accessToken } = await registerUser(app, 'ad-delete@example.com');

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/delete-account')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ confirmation: 'ad-delete@example.com' })
      .expect(200);

    expect(res.body.message).toBe('Account scheduled for deletion');
    expect(res.body.scheduledDeletionAt).toBeDefined();

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { isActive: true, deletedAt: true, scheduledDeletionAt: true },
    });
    expect(dbUser?.isActive).toBe(false);
    expect(dbUser?.deletedAt).not.toBeNull();
    expect(dbUser?.scheduledDeletionAt).not.toBeNull();
  });

  it('POST /auth/delete-account with wrong confirmation should return 400', async () => {
    const { accessToken } = await registerUser(app, 'ad-wrong@example.com');

    await request(app.getHttpServer())
      .post('/api/v1/auth/delete-account')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ confirmation: 'wrong-email@example.com' })
      .expect(400);
  });

  it('POST /auth/delete-account without auth should return 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/delete-account')
      .send({ confirmation: 'test@example.com' })
      .expect(401);
  });

  it('POST /auth/cancel-deletion should reactivate soft-deleted account', async () => {
    const { user, accessToken } = await registerUser(app, 'ad-cancel@example.com');

    // Soft delete
    await request(app.getHttpServer())
      .post('/api/v1/auth/delete-account')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ confirmation: 'ad-cancel@example.com' })
      .expect(200);

    // Cancel deletion
    const cancelRes = await request(app.getHttpServer())
      .post('/api/v1/auth/cancel-deletion')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(cancelRes.body.message).toBe('Account deletion cancelled');

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { isActive: true, deletedAt: true, scheduledDeletionAt: true },
    });
    expect(dbUser?.isActive).toBe(true);
    expect(dbUser?.deletedAt).toBeNull();
    expect(dbUser?.scheduledDeletionAt).toBeNull();
  });

  it('POST /auth/cancel-deletion for active account should return 400', async () => {
    const { accessToken } = await registerUser(app, 'ad-cancel-active@example.com');

    await request(app.getHttpServer())
      .post('/api/v1/auth/cancel-deletion')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('login should reactivate soft-deleted account within grace period', async () => {
    const email = 'ad-reactivate-login@example.com';
    const password = 'SecurePass123';
    const { user } = await registerUser(app, email, password);

    // Soft-delete directly in DB
    const scheduledDeletionAt = new Date();
    scheduledDeletionAt.setDate(scheduledDeletionAt.getDate() + 30);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isActive: false,
        deletedAt: new Date(),
        scheduledDeletionAt,
      },
    });

    // Login should reactivate
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    expect(loginRes.body.user).toBeDefined();
    expect(loginRes.body.user.email).toBe(email);
    expect(loginRes.body.accessToken).toBeDefined();

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { isActive: true, deletedAt: true, scheduledDeletionAt: true },
    });
    expect(dbUser?.isActive).toBe(true);
    expect(dbUser?.deletedAt).toBeNull();
    expect(dbUser?.scheduledDeletionAt).toBeNull();
  });

  it('login should NOT reactivate account past grace period', async () => {
    const email = 'ad-expired-login@example.com';
    const password = 'SecurePass123';
    const { user } = await registerUser(app, email, password);

    // Set scheduledDeletionAt to the past (expired grace period)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isActive: false,
        deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        scheduledDeletionAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      },
    });

    // Login should fail
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(401);
  });
});
