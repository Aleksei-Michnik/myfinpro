import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { MetricsService } from './common/metrics/metrics.service';
import { setupSwagger } from './config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // ── Disable X-Powered-By header (security best practice) ──
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.getInstance().disable('x-powered-by');

  // ── Trust proxy for CloudFlare ──
  // Cloudflare IPv4 ranges: https://www.cloudflare.com/ips-v4/
  // Cloudflare IPv6 ranges: https://www.cloudflare.com/ips-v6/
  httpAdapter
    .getInstance()
    .set('trust proxy', [
      '173.245.48.0/20',
      '103.21.244.0/22',
      '103.22.200.0/22',
      '103.31.4.0/22',
      '141.101.64.0/18',
      '108.162.192.0/18',
      '190.93.240.0/20',
      '188.114.96.0/20',
      '197.234.240.0/22',
      '198.41.128.0/17',
      '162.158.0.0/15',
      '172.64.0.0/13',
      '131.0.72.0/22',
      '104.16.0.0/13',
      '104.24.0.0/14',
      '2400:cb00::/32',
      '2606:4700::/32',
      '2803:f800::/32',
      '2405:b500::/32',
      '2405:8100::/32',
      '2a06:98c0::/29',
      '2c0f:f248::/32',
    ]);

  // ── Security headers (Helmet) ──
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:', 'https://*.googleusercontent.com'],
          connectSrc: ["'self'", 'https://accounts.google.com'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: false, // Allow loading cross-origin resources
    }),
  );

  // ── Cookie parser ──
  app.use(cookieParser());

  // ── Session middleware (required by Passport OAuth2 state parameter) ──
  // Only used for the brief OAuth redirect → callback flow.
  // In-memory store is acceptable: sessions are ephemeral (5 min TTL),
  // and blue-green deployment ensures the same instance handles both legs.
  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production' || nodeEnv === 'staging';
  app.use(
    session({
      secret: configService.get<string>(
        'SESSION_SECRET',
        configService.get<string>('JWT_SECRET', 'dev-session-secret'),
      ),
      resave: false,
      saveUninitialized: false,
      name: '__oauth_session',
      cookie: {
        maxAge: 5 * 60 * 1000, // 5 minutes — just enough for OAuth redirect flow
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
      },
    }),
  );

  // Use pino logger as the NestJS logger
  app.useLogger(app.get(Logger));

  const logger = app.get(Logger);

  // ── Global prefix ──
  const apiPrefix = configService.get<string>('API_GLOBAL_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  // ── Validation pipe ──
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ── Global filters ──
  const metricsService = app.get(MetricsService);
  app.useGlobalFilters(
    new AllExceptionsFilter(metricsService),
    new HttpExceptionFilter(metricsService),
  );

  // ── CORS ──
  const corsOrigins = configService.get<string>('CORS_ORIGINS', 'http://localhost:3000');
  app.enableCors({
    origin: corsOrigins.split(','),
    credentials: true,
  });

  // ── Swagger ──
  const swaggerEnabled = configService.get<string>('SWAGGER_ENABLED', 'true') === 'true';
  if (swaggerEnabled) {
    setupSwagger(app, apiPrefix);
  }

  // ── Start ──
  const port = configService.get<number>('API_PORT', 3001);
  await app.listen(port);

  logger.log(`🚀 API running on http://localhost:${port}/${apiPrefix}`, 'Bootstrap');
  if (swaggerEnabled) {
    logger.log(
      `📚 Swagger docs at http://localhost:${port}/${apiPrefix.replace('/v1', '')}/docs`,
      'Bootstrap',
    );
  }
}

bootstrap();
