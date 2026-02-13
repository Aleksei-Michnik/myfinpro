import { Injectable } from '@nestjs/common';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';

import { getRequestId } from '../context/request-context';

@Injectable()
export class AppLoggerService {
  constructor(
    @InjectPinoLogger(AppLoggerService.name)
    private readonly logger: PinoLogger,
  ) {}

  private enrichContext(context?: Record<string, unknown>): Record<string, unknown> {
    const requestId = getRequestId();
    return {
      ...context,
      ...(requestId ? { requestId } : {}),
    };
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.logger.trace(this.enrichContext(context), message);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.logger.debug(this.enrichContext(context), message);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.logger.info(this.enrichContext(context), message);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.logger.warn(this.enrichContext(context), message);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.logger.error(this.enrichContext(context), message);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.logger.fatal(this.enrichContext(context), message);
  }
}
