import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bootstrapTestApp, registerUser } from './helpers';

/**
 * Integration tests for the Profile Update feature.
 *
 * Covers:
 * - PATCH /auth/profile (currency, timezone, both, empty body, invalid currency, no auth)
 * - Profile data persistence in login and /auth/me responses
 */
describe('Profile Update Integration Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const ctx = await bootstrapTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('PATCH /auth/profile should update currency', async () => {
    const { accessToken } = await registerUser(app, 'pu-currency@example.com');

    const res = await request(app.getHttpServer())
      .patch('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ defaultCurrency: 'EUR' })
      .expect(200);

    expect(res.body.defaultCurrency).toBe('EUR');
  });

  it('PATCH /auth/profile should update timezone', async () => {
    const { accessToken } = await registerUser(app, 'pu-timezone@example.com');

    const res = await request(app.getHttpServer())
      .patch('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ timezone: 'Asia/Jerusalem' })
      .expect(200);

    expect(res.body.timezone).toBe('Asia/Jerusalem');
  });

  it('PATCH /auth/profile should update both currency and timezone', async () => {
    const { accessToken } = await registerUser(app, 'pu-both@example.com');

    const res = await request(app.getHttpServer())
      .patch('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ defaultCurrency: 'GBP', timezone: 'Europe/London' })
      .expect(200);

    expect(res.body.defaultCurrency).toBe('GBP');
    expect(res.body.timezone).toBe('Europe/London');
  });

  it('PATCH /auth/profile with invalid currency should return 400', async () => {
    const { accessToken } = await registerUser(app, 'pu-invalid-curr@example.com');

    await request(app.getHttpServer())
      .patch('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ defaultCurrency: 'INVALID' })
      .expect(400);
  });

  it('PATCH /auth/profile with empty body should return current profile', async () => {
    const { accessToken, user } = await registerUser(app, 'pu-empty@example.com');

    const res = await request(app.getHttpServer())
      .patch('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(200);

    expect(res.body.email).toBe(user.email);
    expect(res.body.defaultCurrency).toBe('USD');
  });

  it('PATCH /auth/profile without auth should return 401', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/auth/profile')
      .send({ defaultCurrency: 'EUR' })
      .expect(401);
  });

  it('profile data should persist in login response', async () => {
    const email = 'pu-persist-login@example.com';
    const { accessToken } = await registerUser(app, email);

    await request(app.getHttpServer())
      .patch('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' })
      .expect(200);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'SecurePass123' })
      .expect(200);

    expect(loginRes.body.user.defaultCurrency).toBe('ILS');
    expect(loginRes.body.user.timezone).toBe('Asia/Jerusalem');
  });

  it('profile data should persist in /auth/me response', async () => {
    const email = 'pu-persist-me@example.com';
    const { accessToken } = await registerUser(app, email);

    await request(app.getHttpServer())
      .patch('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ defaultCurrency: 'JPY', timezone: 'Asia/Tokyo' })
      .expect(200);

    const meRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(meRes.body.defaultCurrency).toBe('JPY');
    expect(meRes.body.timezone).toBe('Asia/Tokyo');
  });
});
