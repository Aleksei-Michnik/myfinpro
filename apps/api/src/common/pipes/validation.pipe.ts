import { ValidationPipe as NestValidationPipe, ValidationPipeOptions } from '@nestjs/common';

/**
 * Pre-configured validation pipe with project defaults.
 * Used as a reference; the global pipe is set in main.ts.
 */
export const createValidationPipe = (options?: ValidationPipeOptions) =>
  new NestValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
    ...options,
  });
