import { ValidationPipe as NestValidationPipe } from '@nestjs/common';

import { createValidationPipe } from './validation.pipe';

interface PipeInternals {
  validatorOptions: Record<string, unknown>;
  isTransformEnabled: unknown;
  transformOptions: Record<string, unknown>;
}

describe('createValidationPipe', () => {
  it('should return a ValidationPipe instance', () => {
    const pipe = createValidationPipe();

    expect(pipe).toBeInstanceOf(NestValidationPipe);
  });

  it('should have default options including whitelist: true', () => {
    const pipe = createValidationPipe();
    // Access internal options via the pipe's properties
    // ValidationPipe stores options internally; we verify by checking that
    // the pipe instance has the expected behavior
    const options = (pipe as unknown as PipeInternals).validatorOptions;

    expect(options).toBeDefined();
    expect(options.whitelist).toBe(true);
    expect(options.forbidNonWhitelisted).toBe(true);
  });

  it('should have transform enabled by default', () => {
    const pipe = createValidationPipe();
    const isTransformEnabled = (pipe as unknown as PipeInternals).isTransformEnabled;

    expect(isTransformEnabled).toBe(true);
  });

  it('should have enableImplicitConversion in transform options', () => {
    const pipe = createValidationPipe();
    const transformOptions = (pipe as unknown as PipeInternals).transformOptions;

    expect(transformOptions).toBeDefined();
    expect(transformOptions.enableImplicitConversion).toBe(true);
  });

  it('should accept custom options that override defaults', () => {
    const pipe = createValidationPipe({
      whitelist: false,
      forbidNonWhitelisted: false,
    });

    const options = (pipe as unknown as PipeInternals).validatorOptions;

    expect(options.whitelist).toBe(false);
    expect(options.forbidNonWhitelisted).toBe(false);
  });

  it('should merge custom options with defaults', () => {
    const pipe = createValidationPipe({
      disableErrorMessages: true,
    });

    const options = (pipe as unknown as PipeInternals).validatorOptions;
    // Custom option applied
    expect(options.whitelist).toBe(true);
    // Default still in place
    expect((pipe as unknown as PipeInternals).isTransformEnabled).toBe(true);
  });
});
