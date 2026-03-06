import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
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
  httpAdapter
    .getInstance()
    .set('trust proxy', [
      '173.245.48.0/20',
      '103.21.244.0/20',
      '103.22.200.0/20',
      '103.31.4.0/20',
      '104.16.0/12',
      '108.162.192.0/18',
      '131.0.72.0/22',
      '141.101.64.0/18',
      '172.64.0.0/13',
      '172.80.0.0/12',
      '188.114.96.0/20',
      '190.93.240.0/20',
      '197.234.240.0/22',
      '198.41.128.0/17',
      '2400:cb00::/32',
      '2606:4700::/32',
      '2803:f800::/32',
      '2405:b500::/32',
      '2405:8100::/32',
      '2a06:98c0::/29',
      '2c0f:f248::/32',
    ]);

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
  const port = configService.get<number>('API_PORT', 4000);
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
