import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { MetricsService } from './common/metrics/metrics.service';
import { setupSwagger } from './config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // ── Trust proxy for CloudFlare ──
  const httpAdapter = app.getHttpAdapter();
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
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow loading cross-origin resources
  }));

  // Use pino logger as the NestJS logger
  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
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
