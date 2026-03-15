import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Auth Integration Tests', () => {
  let app: INestApplication;

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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user with valid data and return JWT access token', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'test@example.com',
          password: 'SecurePass123',
          name: 'Test User',
        })
        .expect(201)
        .expect((res: request.Response) => {
          expect(res.body.user).toBeDefined();
          expect(res.body.user.email).toBe('test@example.com');
          expect(res.body.user.name).toBe('Test User');
          expect(res.body.user.passwordHash).toBeUndefined(); // MUST NOT expose hash
          expect(res.body.accessToken).toBeDefined();
          // Verify it's a real JWT (3 parts separated by dots)
          expect(res.body.accessToken.split('.')).toHaveLength(3);
        });
    });

    it('should set a refresh_token cookie on register', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'cookie-test@example.com',
          password: 'SecurePass123',
          name: 'Cookie Test User',
        })
        .expect(201)
        .expect((res: request.Response) => {
          const cookies = res.headers['set-cookie'];
          expect(cookies).toBeDefined();
          const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
          const refreshCookie = cookieArray.find((c: string) => c.startsWith('refresh_token='));
          expect(refreshCookie).toBeDefined();
          expect(refreshCookie).toContain('HttpOnly');
          expect(refreshCookie).toContain('Path=/api/v1/auth');
        });
    });

    it('should reject registration with invalid email', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'not-an-email',
          password: 'SecurePass123',
          name: 'Test',
        })
        .expect(400);
    });

    it('should reject registration with weak password', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'test2@example.com',
          password: 'weak',
          name: 'Test',
        })
        .expect(400);
    });

    it('should reject registration without required fields', () => {
      return request(app.getHttpServer()).post('/api/v1/auth/register').send({}).expect(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login with valid credentials and return JWT access token', async () => {
      // First register a user
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'login-test@example.com',
          password: 'SecurePass123',
          name: 'Login Test User',
        })
        .expect(201);

      // Then login
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'login-test@example.com',
          password: 'SecurePass123',
        })
        .expect(200)
        .expect((res: request.Response) => {
          expect(res.body.user).toBeDefined();
          expect(res.body.user.email).toBe('login-test@example.com');
          expect(res.body.user.name).toBe('Login Test User');
          expect(res.body.user.passwordHash).toBeUndefined(); // MUST NOT expose hash
          expect(res.body.accessToken).toBeDefined();
          // Verify it's a real JWT (3 parts separated by dots)
          expect(res.body.accessToken.split('.')).toHaveLength(3);
        });
    });

    it('should set a refresh_token cookie on login', async () => {
      // Register then login
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'login-cookie-test@example.com',
          password: 'SecurePass123',
          name: 'Login Cookie Test',
        })
        .expect(201);

      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'login-cookie-test@example.com',
          password: 'SecurePass123',
        })
        .expect(200)
        .expect((res: request.Response) => {
          const cookies = res.headers['set-cookie'];
          expect(cookies).toBeDefined();
          const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
          const refreshCookie = cookieArray.find((c: string) => c.startsWith('refresh_token='));
          expect(refreshCookie).toBeDefined();
          expect(refreshCookie).toContain('HttpOnly');
          expect(refreshCookie).toContain('Path=/api/v1/auth');
        });
    });

    it('should return 401 for wrong password', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'login-test@example.com',
          password: 'WrongPassword123',
        })
        .expect(401)
        .expect((res: request.Response) => {
          expect(res.body.message).toBe('Invalid email or password');
        });
    });

    it('should return 401 for non-existent email', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'SecurePass123',
        })
        .expect(401)
        .expect((res: request.Response) => {
          expect(res.body.message).toBe('Invalid email or password');
        });
    });

    it('should return 400 for invalid email format (DTO validation)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'not-an-email',
          password: 'SecurePass123',
        })
        .expect(400);
    });

    it('should return 400 for missing password', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh tokens with valid cookie and return new access token', async () => {
      // Register a user to get a refresh token cookie
      const registerRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'refresh-test@example.com',
          password: 'SecurePass123',
          name: 'Refresh Test User',
        })
        .expect(201);

      // Extract refresh_token cookie
      const cookies = registerRes.headers['set-cookie'];
      const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
      const refreshCookie = cookieArray.find((c: string) => c.startsWith('refresh_token='));
      expect(refreshCookie).toBeDefined();

      // Use the cookie to refresh tokens
      return request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [refreshCookie!])
        .expect(200)
        .expect((res: request.Response) => {
          expect(res.body.accessToken).toBeDefined();
          // Verify it's a real JWT
          expect(res.body.accessToken.split('.')).toHaveLength(3);

          // Should also set a new refresh cookie
          const newCookies = res.headers['set-cookie'];
          expect(newCookies).toBeDefined();
          const newCookieArray = Array.isArray(newCookies) ? newCookies : [newCookies];
          const newRefreshCookie = newCookieArray.find((c: string) =>
            c.startsWith('refresh_token='),
          );
          expect(newRefreshCookie).toBeDefined();
          expect(newRefreshCookie).toContain('HttpOnly');
        });
    });

    it('should return 401 when no refresh token cookie is provided', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .expect(401)
        .expect((res: request.Response) => {
          expect(res.body.message).toBe('No refresh token provided');
        });
    });

    it('should return 401 when using an invalid refresh token', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', ['refresh_token=invalid-token-value'])
        .expect(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should logout and clear cookie', async () => {
      // Register a user to get a refresh token cookie
      const registerRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'logout-test@example.com',
          password: 'SecurePass123',
          name: 'Logout Test User',
        })
        .expect(201);

      // Extract refresh_token cookie
      const cookies = registerRes.headers['set-cookie'];
      const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
      const refreshCookie = cookieArray.find((c: string) => c.startsWith('refresh_token='));

      // Logout
      return request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', [refreshCookie!])
        .expect(200)
        .expect((res: request.Response) => {
          expect(res.body.message).toBe('Logged out successfully');

          // Cookie should be cleared
          const logoutCookies = res.headers['set-cookie'];
          if (logoutCookies) {
            const logoutCookieArray = Array.isArray(logoutCookies)
              ? logoutCookies
              : [logoutCookies];
            const clearedCookie = logoutCookieArray.find((c: string) =>
              c.startsWith('refresh_token='),
            );
            if (clearedCookie) {
              // Should be expired or empty
              expect(
                clearedCookie.includes('Expires=Thu, 01 Jan 1970') ||
                  clearedCookie.includes('Max-Age=0') ||
                  clearedCookie === 'refresh_token=;',
              ).toBeTruthy();
            }
          }
        });
    });

    it('should return 200 even without a refresh token cookie', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .expect(200)
        .expect((res: request.Response) => {
          expect(res.body.message).toBe('Logged out successfully');
        });
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return 401 without token', () => {
      return request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });

    it('should return user data with valid token', async () => {
      // Register a user to get an access token
      const registerRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'me-test@example.com',
          password: 'SecurePass123',
          name: 'Me Test User',
        })
        .expect(201);

      const accessToken = registerRes.body.accessToken;
      expect(accessToken).toBeDefined();

      // Use the access token to get user profile
      return request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res: request.Response) => {
          expect(res.body.id).toBeDefined();
          expect(res.body.email).toBe('me-test@example.com');
          expect(res.body.name).toBe('Me Test User');
          expect(res.body.defaultCurrency).toBe('USD');
          expect(res.body.locale).toBe('en');
          expect(res.body.timezone).toBeDefined();
          expect(res.body.passwordHash).toBeUndefined();
        });
    });

    it('should return 401 with invalid token', () => {
      return request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('Full auth flow: register → refresh → logout', () => {
    it('should complete the entire auth lifecycle', async () => {
      // Step 1: Register
      const registerRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'full-flow@example.com',
          password: 'SecurePass123',
          name: 'Full Flow User',
        })
        .expect(201);

      expect(registerRes.body.accessToken).toBeDefined();

      // Extract refresh cookie
      const regCookies = registerRes.headers['set-cookie'];
      const regCookieArray = Array.isArray(regCookies) ? regCookies : [regCookies];
      const regRefreshCookie = regCookieArray.find((c: string) => c.startsWith('refresh_token='));
      expect(regRefreshCookie).toBeDefined();

      // Step 2: Refresh tokens
      const refreshRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [regRefreshCookie!])
        .expect(200);

      expect(refreshRes.body.accessToken).toBeDefined();

      // Extract new refresh cookie
      const refCookies = refreshRes.headers['set-cookie'];
      const refCookieArray = Array.isArray(refCookies) ? refCookies : [refCookies];
      const newRefreshCookie = refCookieArray.find((c: string) => c.startsWith('refresh_token='));
      expect(newRefreshCookie).toBeDefined();

      // Step 3: Old token should no longer work (already rotated)
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [regRefreshCookie!])
        .expect(401);

      // Step 4: Logout with the new token
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', [newRefreshCookie!])
        .expect(200);

      // Step 5: After logout, the new token should no longer work
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [newRefreshCookie!])
        .expect(401);
    });
  });
});
