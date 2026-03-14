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
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({})
        .expect(400);
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
});
