import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { getRequestId } from '../context/request-context';
import { MetricsService } from '../metrics/metrics.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly metricsService?: MetricsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const isProduction = process.env.NODE_ENV === 'production';
    const requestId = getRequestId() || (request as Request & { requestId?: string }).requestId;

    // If it's an HttpException, let the HttpExceptionFilter handle it
    // This filter is the catch-all for non-HTTP exceptions
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const errorResponse = {
      statusCode: status,
      message: isProduction
        ? 'Internal server error'
        : typeof message === 'string'
          ? message
          : (message as Record<string, unknown>).message || message,
      error:
        exception instanceof HttpException
          ? exception.name
          : 'InternalServerError',
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
      // Include stack trace in development only
      ...(!isProduction &&
        exception instanceof Error && { stack: exception.stack }),
    };

    const logContext = {
      requestId,
      userId: (request as Request & { user?: { id?: string } }).user?.id,
      method: request.method,
      path: request.url,
      statusCode: status,
      exceptionType:
        exception instanceof Error
          ? exception.constructor.name
          : typeof exception,
    };

    this.logger.error(
      `Unhandled exception: ${request.method} ${request.url} ${status}`,
      exception instanceof Error ? exception.stack : String(exception),
      JSON.stringify(logContext),
    );

    // Track in metrics
    this.metricsService?.incrementErrors(status);

    response.status(status).json(errorResponse);
  }
}
