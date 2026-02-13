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
