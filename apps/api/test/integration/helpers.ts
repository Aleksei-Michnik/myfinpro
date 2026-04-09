import * as crypto from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Shared helpers for integration tests.
 *
 * Provides app bootstrap, user registration/login helpers, and token hashing.
 */

export interface IntegrationTestContext {
  app: INestApplication;
  prisma: PrismaService;
}

/**
 * Bootstrap a NestJS test application with the same middleware as production.
 */
export async function bootstrapTestApp(): Promise<IntegrationTestContext> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
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

  const prisma = moduleFixture.get(PrismaService);

  return { app, prisma };
}

/**
 * Register a user and return accessToken, user data, and cookies.
 */
export async function registerUser(
  app: INestApplication,
  email: string,
  password: string = 'SecurePass123',
  name: string = 'Test User',
) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password, name })
    .expect(201);

  const rawCookies = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];

  return {
    accessToken: res.body.accessToken as string,
    user: res.body.user as {
      id: string;
      email: string;
      name: string;
      defaultCurrency: string;
      locale: string;
      timezone: string;
      emailVerified: boolean;
    },
    cookies,
  };
}

/**
 * Login a user and return accessToken, user data, and cookies.
 */
export async function loginUser(
  app: INestApplication,
  email: string,
  password: string = 'SecurePass123',
) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);

  const rawCookies = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];

  return {
    accessToken: res.body.accessToken as string,
    user: res.body.user,
    cookies,
  };
}

/**
 * SHA-256 hash — matches EmailVerificationService.hashToken() and PasswordResetService.hashToken()
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
